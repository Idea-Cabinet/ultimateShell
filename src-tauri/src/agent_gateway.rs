use chrono::Local;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Method, Response, Server, StatusCode};

use russh::server::{
    Auth as RusshAuth, ChannelOpenHandle, Handler as RusshHandler, Msg, Server as RusshServer,
    Session as RusshSession, VerifiedPublicKey,
};
use russh::{Channel, ChannelId};

use crate::agent_connections::AgentConnections;
use crate::hosts::load_hosts;
use crate::pty::{PtyManager, SpawnOptions};

// The gateway identity must survive app restarts. Never silently replace a damaged key.
fn load_gateway_host_key(path: &std::path::Path) -> Result<russh::keys::PrivateKey, String> {
    use std::io::Write;
    let parent = path.parent().ok_or("网关密钥路径无效")?;
    std::fs::create_dir_all(parent).map_err(|e| format!("创建网关密钥目录失败：{e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    if !path.exists() {
        let key =
            russh::keys::PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519)
                .map_err(|e| format!("生成网关主机密钥失败：{e}"))?;
        let temporary = parent.join(format!(".host-key-{}", uuid::Uuid::new_v4()));
        let result = (|| -> Result<(), String> {
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temporary).map_err(|e| e.to_string())?;
            let pem = key
                .to_openssh(russh::keys::ssh_key::LineEnding::LF)
                .map_err(|e| e.to_string())?;
            file.write_all(pem.as_bytes()).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            match std::fs::hard_link(&temporary, path) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
                Err(e) => Err(format!("保存网关主机密钥失败：{e}")),
            }
        })();
        let _ = std::fs::remove_file(temporary);
        result?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    let key = russh::keys::PrivateKey::read_openssh_file(path)
        .map_err(|e| format!("读取网关主机密钥失败（不会自动替换）：{e}"))?;
    let public = key.public_key().to_openssh().map_err(|e| e.to_string())?;
    std::fs::write(path.with_extension("pub"), format!("{public}\n")).map_err(|e| e.to_string())?;
    Ok(key)
}

#[cfg(test)]
thread_local! {static TEST_STATE_DIR:std::cell::RefCell<Option<std::path::PathBuf>>=const{std::cell::RefCell::new(None)};}
#[cfg(test)]
thread_local! {static TEST_REMOTE:std::cell::RefCell<Option<SpawnOptions>>=const{std::cell::RefCell::new(None)};}
pub(crate) fn gateway_state_dir() -> Result<std::path::PathBuf, String> {
    #[cfg(test)]
    if let Some(path) = TEST_STATE_DIR.with(|p| p.borrow().clone()) {
        return Ok(path);
    }
    std::env::var_os("HOME")
        .map(|home| std::path::PathBuf::from(home).join(".ultimateshell/agent-gateway"))
        .ok_or_else(|| "无法确定网关配置目录".into())
}

fn load_gateway_token(path: &std::path::Path) -> Result<String, String> {
    use std::io::Write;
    let parent = path.parent().ok_or("网关 Token 路径无效")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    if !path.exists() {
        let temporary = parent.join(format!(".token-{}", uuid::Uuid::new_v4()));
        let result = (|| -> Result<(), String> {
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temporary).map_err(|e| e.to_string())?;
            let token = format!("us_gate_{}", uuid::Uuid::new_v4().simple());
            file.write_all(token.as_bytes())
                .map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            match std::fs::hard_link(&temporary, path) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
                Err(e) => Err(e.to_string()),
            }
        })();
        let _ = std::fs::remove_file(temporary);
        result?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    let token = std::fs::read_to_string(path).map_err(|_| "无法读取网关 Token".to_string())?;
    let token = token.trim();
    let valid = token
        .strip_prefix("us_gate_")
        .is_some_and(|suffix| suffix.len() == 32 && suffix.bytes().all(|c| c.is_ascii_hexdigit()));
    if !valid {
        return Err("网关 Token 文件损坏，已停止启动网关；不会静默替换".into());
    }
    Ok(token.to_owned())
}

fn request_target(payload: &serde_json::Value) -> Result<String, String> {
    let read = |field: &str| -> Result<Option<&str>, String> {
        match payload.get(field) {
            None => Ok(None),
            Some(value) => value
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(Some)
                .ok_or_else(|| format!("'{field}' must be a non-empty string")),
        }
    };
    let target = read("target")?;
    let server = read("server")?;
    if matches!((target, server), (Some(a), Some(b)) if a != b) {
        return Err("Conflicting 'target' and 'server' fields".into());
    }
    target.or(server).map(str::to_owned).ok_or_else(|| {
        "Missing 'target' (or 'server'); use 'local' explicitly for local execution".into()
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalPolicy {
    Strict, // "请求批准": 所有增删改 (L1, L2) 均需弹窗询问
    Smart,  // "帮我批准": 仅高危逻辑 (L2) 弹窗询问，常规写操作 (L1) 自动通过
    Auto,   // "全部批准": 全部通过 (0 弹窗)，仅记录审计日志
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandRiskLevel {
    Safe,     // L0: 只读排查 (cat, ls, grep, ps, systemctl status, etc.)
    Mutation, // L1: 常规增删改 (systemctl restart, touch, cp, mv, etc.)
    Critical, // L2: 致命高危 (rm -rf, reboot, shutdown, mkfs, iptables -F, etc.)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLogEntry {
    pub id: String,
    pub timestamp: String,
    pub agent_name: String,
    pub server_target: String,
    pub command: String,
    pub risk_level: CommandRiskLevel,
    pub policy_applied: ApprovalPolicy,
    pub approved_by_user: bool,
    #[serde(default)]
    pub approval_source: String,
    #[serde(default)]
    pub execution_phase: String,
    pub status: String, // "executed" | "denied" | "timeout" | "failed"
    pub exit_code: Option<i32>,
    pub output_snippet: Option<String>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalRequestPayload {
    pub id: String,
    pub server_target: String,
    pub command: String,
    pub risk_level: CommandRiskLevel,
    pub policy: ApprovalPolicy,
    pub timestamp: String,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayStatusPayload {
    pub is_running: bool,
    pub port: u16,
    pub ssh_port: u16,
    pub ssh_running: bool,
    pub token: String,
    pub policy: ApprovalPolicy,
    pub active_servers_count: usize,
    pub audit_count: usize,
    pub pending_approvals_count: usize,
    pub audit_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfoPayload {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub is_connected: bool,
    pub is_local: bool,
}

pub fn classify_command(cmd: &str) -> CommandRiskLevel {
    use CommandRiskLevel::{Critical, Mutation, Safe};
    let trimmed = cmd.trim();
    if trimmed.is_empty() {
        return Safe;
    }
    // Only classify simple commands. A shell/interpreter program is not evidence of read-only behavior.
    if trimmed.chars().any(|c| "\n;|&`$()<>".contains(c)) {
        return Critical;
    }
    let words: Vec<_> = trimmed.split_whitespace().collect();
    let executable = words[0];
    if executable.contains('/')
        && !executable.starts_with("/bin/")
        && !executable.starts_with("/usr/bin/")
    {
        return Critical;
    }
    let program = executable.rsplit('/').next().unwrap_or("");
    if executable.contains('/')
        && executable != format!("/bin/{program}")
        && executable != format!("/usr/bin/{program}")
    {
        return Critical;
    }
    let args = &words[1..];
    match program {
        "hostname" => {
            if args
                .iter()
                .all(|a| ["-s", "-f", "-i", "-I", "-d"].contains(a))
            {
                Safe
            } else {
                Critical
            }
        }
        "date" => {
            if args
                .iter()
                .all(|a| a.starts_with('+') || ["-u", "-R", "--utc", "--iso-8601"].contains(a))
            {
                Safe
            } else {
                Critical
            }
        }
        "ss" => {
            if args
                .iter()
                .any(|a| *a == "--kill" || (a.starts_with('-') && a.contains('K')))
            {
                Critical
            } else {
                Safe
            }
        }
        "uptime" | "uname" | "whoami" | "id" | "pwd" | "ls" | "cat" | "head" | "tail" | "wc"
        | "stat" | "df" | "free" | "nproc" | "ps" | "sha256sum" | "true" | "false" => Safe,
        "mkdir" | "touch" | "cp" | "mv" | "rmdir" | "chown" | "chgrp" => Mutation,
        "rm" => {
            let flags = args
                .iter()
                .filter(|a| a.starts_with('-'))
                .copied()
                .collect::<Vec<_>>()
                .join("");
            if flags.contains('r') || flags.contains('R') || flags.contains("--recursive") {
                Critical
            } else {
                Mutation
            }
        }
        "chmod" => {
            if args.iter().any(|a| *a == "777" || *a == "a+rwx") {
                Critical
            } else {
                Mutation
            }
        }
        "systemctl" => match args.first().copied() {
            Some(
                "status" | "show" | "is-active" | "is-enabled" | "list-units" | "list-unit-files",
            ) => Safe,
            Some(
                "start" | "stop" | "restart" | "reload" | "enable" | "disable" | "mask" | "unmask",
            ) => Mutation,
            _ => Critical,
        },
        "docker" => match args.first().copied() {
            Some("ps" | "info" | "inspect" | "version" | "stats") => Safe,
            Some("restart" | "stop" | "rm" | "rmi" | "kill") => Mutation,
            _ => Critical,
        },
        _ => Critical,
    }
}

pub fn needs_user_approval(risk: CommandRiskLevel, policy: ApprovalPolicy) -> bool {
    match policy {
        ApprovalPolicy::Auto => false, // 全部批准: 永远不弹窗
        ApprovalPolicy::Smart => {
            // 帮我批准: 仅高危逻辑 (Critical) 弹窗，Safe 和 Mutation 自动放行
            risk == CommandRiskLevel::Critical
        }
        ApprovalPolicy::Strict => {
            // 请求批准: 只要是修改操作 (Mutation 或 Critical)，都弹窗询问
            risk != CommandRiskLevel::Safe
        }
    }
}

pub fn redact_sensitive_output(raw: &str) -> String {
    use std::sync::OnceLock;
    static PATTERNS: OnceLock<Vec<regex::Regex>> = OnceLock::new();
    if raw.contains("PRIVATE KEY-----") {
        return "[REDACTED PRIVATE KEY CONTENT]".into();
    }
    let patterns=PATTERNS.get_or_init(||[
        r#"(?i)((?:[\w.-]*[_-])?(?:password|passwd|secret|token|api[_-]?key|key)[\"']?\s*(?:[=:]\s*|\s+)")(?:\\.|[^"\\])*(")"#,
        r#"(?i)((?:[\w.-]*[_-])?(?:password|passwd|secret|token|api[_-]?key|key)[\"']?\s*(?:[=:]\s*|\s+)')(?:\\.|[^'\\])*(')"#,
        r#"(?i)((?:https?|mongodb(?:\+srv)?|redis|postgres(?:ql)?)://)[^:/\s]+:[^@/\s]+@"#,
        r#"(?i)(bearer\s+)[^\s\"']+"#,
        r#"(?i)((?:[\w.-]*[_-])?(?:password|passwd|secret|token|api[_-]?key|key)[\"']?\s*(?:[=:]\s*|\s+)[\"']?)[^\s\"'&,;}]+"#,
        r#"(us_gate_)[A-Za-z0-9_-]+"#,
    ].iter().map(|s|regex::Regex::new(s).expect("static redaction regex")).collect());
    let mut out = raw.to_owned();
    for regex in patterns {
        out = regex
            .replace_all(&out, |caps: &regex::Captures<'_>| {
                format!("{}***{}", &caps[1], caps.get(2).map_or("", |m| m.as_str()))
            })
            .into_owned();
    }

    out
}

fn required_string<'a>(value: &'a serde_json::Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| format!("Missing or invalid {key}"))
}
struct RequestSlot(Arc<std::sync::atomic::AtomicUsize>);
impl Drop for RequestSlot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

struct Grant {
    source: String,
    policy: ApprovalPolicy,
}
pub struct ListenerState {
    cancel: Arc<AtomicBool>,
    workers: Vec<std::thread::JoinHandle<()>>,
}
fn constant_time_equal(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |diff, (a, b)| diff | (a ^ b)) == 0
}
#[derive(Clone)]
pub struct AgentGateway {
    pub port: u16,
    pub state_directory: std::path::PathBuf,
    pub ssh_port: Arc<AtomicU16>,
    pub ssh_running: Arc<AtomicBool>,
    pub token: String,
    pub policy: Arc<Mutex<ApprovalPolicy>>,
    pub is_running: Arc<AtomicBool>,
    pub pending_approvals: Arc<Mutex<HashMap<String, mpsc::Sender<bool>>>>,
    pub approval_requests: Arc<Mutex<HashMap<String, ApprovalRequestPayload>>>,
    pub audit_logs: Arc<Mutex<Vec<AuditLogEntry>>>,
    pub pty_mgr: PtyManager,
    pub connections: AgentConnections,
    pub control_connections: AgentConnections,
    pub transfer_connections: AgentConnections,
    pub app_handle: Option<AppHandle>,
    pub active_requests: Arc<std::sync::atomic::AtomicUsize>,
    pub work_requests: Arc<std::sync::atomic::AtomicUsize>,
    pub audit_error: Arc<Mutex<Option<String>>>,
    pub audit_pending: Arc<Mutex<std::collections::VecDeque<AuditLogEntry>>>,
    pub audit_lost: Arc<std::sync::atomic::AtomicUsize>,
    pub listeners: Arc<Mutex<Option<ListenerState>>>,
    pub client_public: Vec<u8>,
    pub ssh_ports: (u16, u16),
}

impl AgentGateway {
    pub fn new(pty_mgr: PtyManager, app_handle: AppHandle) -> Result<Self, String> {
        let token = load_gateway_token(&gateway_state_dir()?.join("token"))?;
        let client_key = load_gateway_host_key(&gateway_state_dir()?.join("client_ed25519"))?;
        let client_public = client_key
            .public_key()
            .to_bytes()
            .map_err(|e| e.to_string())?;
        let port = 39281;
        let ssh_port = Arc::new(AtomicU16::new(2222));
        let ssh_running = Arc::new(AtomicBool::new(false));

        Ok(Self {
            port,
            state_directory: gateway_state_dir()?,
            ssh_port,
            ssh_running,
            token,
            policy: Arc::new(Mutex::new(ApprovalPolicy::Smart)), // Default: "帮我批准"
            is_running: Arc::new(AtomicBool::new(false)),
            pending_approvals: Arc::new(Mutex::new(HashMap::new())),
            approval_requests: Default::default(),
            audit_logs: Arc::new(Mutex::new(crate::gateway_audit::load(
                &gateway_state_dir()?.join("audit.jsonl"),
            ))),
            pty_mgr,
            connections: AgentConnections::new(),
            control_connections: AgentConnections::new(),
            transfer_connections: AgentConnections::new(),
            app_handle: Some(app_handle),
            active_requests: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            work_requests: Default::default(),
            audit_error: Default::default(),
            audit_pending: Default::default(),
            audit_lost: Default::default(),
            listeners: Default::default(),
            client_public,
            ssh_ports: (2222, 39222),
        })
    }

    fn scoped_state<T>(&self, operation: impl FnOnce() -> T) -> T {
        #[cfg(test)]
        {
            struct Restore(Option<std::path::PathBuf>);
            impl Drop for Restore {
                fn drop(&mut self) {
                    TEST_STATE_DIR.with(|p| *p.borrow_mut() = self.0.take());
                }
            }
            let previous = TEST_STATE_DIR.with(|p| p.replace(Some(self.state_directory.clone())));
            let _restore = Restore(previous);
            operation()
        }
        #[cfg(not(test))]
        {
            operation()
        }
    }
    pub fn start_server(&self) -> Result<(), String> {
        let mut lifecycle = self.listeners.lock().map_err(|e| e.to_string())?;
        if lifecycle.as_ref().is_some_and(|state| {
            !state.cancel.load(Ordering::SeqCst) && self.is_running.load(Ordering::SeqCst)
        }) {
            return Ok(());
        }
        if let Some(previous) = lifecycle.take() {
            previous.cancel.store(true, Ordering::SeqCst);
            for worker in previous.workers {
                let _ = worker.join();
            }
        }
        self.is_running.store(false, Ordering::SeqCst);
        self.ssh_running.store(false, Ordering::SeqCst);
        // Bind both listeners before reporting running; partial startup releases all sockets.
        let http = Server::http(format!("127.0.0.1:{}", self.port))
            .map_err(|e| format!("HTTP网关启动失败：{e}"))?;
        let ssh = std::net::TcpListener::bind(("127.0.0.1", self.ssh_ports.0))
            .or_else(|_| std::net::TcpListener::bind(("127.0.0.1", self.ssh_ports.1)))
            .map_err(|e| format!("SSH网关启动失败：{e}"))?;
        ssh.set_nonblocking(true).map_err(|e| e.to_string())?;
        let port = ssh.local_addr().map_err(|e| e.to_string())?.port();
        let host_key = load_gateway_host_key(&self.state_directory.join("host_ed25519"))?;
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .map_err(|e| e.to_string())?;
        let cancel = Arc::new(AtomicBool::new(false));
        self.is_running.store(true, Ordering::SeqCst);
        self.ssh_running.store(true, Ordering::SeqCst);
        self.ssh_port.store(port, Ordering::SeqCst);
        let gw = self.clone();
        let stop = cancel.clone();
        let http_worker = std::thread::spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                match http.recv_timeout(Duration::from_millis(100)) {
                    Ok(Some(request)) => {
                        if stop.load(Ordering::SeqCst) {
                            gw.respond_json(
                                request,
                                StatusCode(503),
                                &serde_json::json!({"ok":false,"error":"Gateway stopped"}),
                            );
                            continue;
                        }
                        let work = if *request.method() != Method::Get {
                            if gw.work_requests.fetch_add(1, Ordering::SeqCst) >= 8 {
                                gw.work_requests.fetch_sub(1, Ordering::SeqCst);
                                gw.respond_json(request,StatusCode(429),&serde_json::json!({"ok":false,"error":"Work capacity reached; query original IDs"}));
                                continue;
                            }
                            Some(RequestSlot(gw.work_requests.clone()))
                        } else {
                            None
                        };
                        if gw.active_requests.fetch_add(1, Ordering::SeqCst) >= 16 {
                            gw.active_requests.fetch_sub(1, Ordering::SeqCst);
                            gw.respond_json(
                                request,
                                StatusCode(429),
                                &serde_json::json!({"ok":false,"error":"Too many active requests"}),
                            );
                            continue;
                        }
                        let request_gateway = gw.clone();
                        std::thread::spawn(move || {
                            let _slot = RequestSlot(request_gateway.active_requests.clone());
                            let _work = work;
                            request_gateway
                                .scoped_state(|| request_gateway.handle_http_request(request));
                        });
                    }
                    Ok(None) => {}
                    Err(e) => {
                        eprintln!("[gateway] HTTP接收失败：{e}");
                        stop.store(true, Ordering::SeqCst);
                        gw.is_running.store(false, Ordering::SeqCst);
                        gw.ssh_running.store(false, Ordering::SeqCst);
                        break;
                    }
                }
            }
        });
        let gw = self.clone();
        let stop = cancel.clone();
        let ssh_worker = std::thread::spawn(move || {
            rt.block_on(async{
                let listener=tokio::net::TcpListener::from_std(ssh).expect("nonblocking owned listener");
                let config=Arc::new(russh::server::Config{inactivity_timeout:Some(Duration::from_secs(3600)),auth_rejection_time:Duration::from_millis(200),keys:vec![host_key],..Default::default()});
                let mut server=AgentSshServer{gateway:gw.clone()};
                let running=server.run_on_socket(config,&listener);let handle=running.handle();
                tokio::select!{result=running=>{if let Err(e)=result{eprintln!("[gateway] SSH监听失败：{e}");}},_=async{while !stop.load(Ordering::SeqCst){tokio::time::sleep(Duration::from_millis(50)).await;}}=>{handle.shutdown("Gateway stopped".into());}}
            });
            stop.store(true, Ordering::SeqCst);
            gw.is_running.store(false, Ordering::SeqCst);
            gw.ssh_running.store(false, Ordering::SeqCst);
            // Approved blocking operations may finish, but a UI stop must not wait for their runtime timeout.
            rt.shutdown_background();
        });
        *lifecycle = Some(ListenerState {
            cancel,
            workers: vec![http_worker, ssh_worker],
        });
        Ok(())
    }
    pub fn stop_server(&self) {
        let mut lifecycle = self.listeners.lock().unwrap();
        self.is_running.store(false, Ordering::SeqCst);
        self.ssh_running.store(false, Ordering::SeqCst);
        if let Some(state) = lifecycle.take() {
            state.cancel.store(true, Ordering::SeqCst);
            for worker in state.workers {
                let _ = worker.join();
            }
        }
        for (_, sender) in self.pending_approvals.lock().unwrap().drain() {
            let _ = sender.send(false);
        }
        self.connections.clear();
        self.control_connections.clear();
        self.transfer_connections.clear();
    }

    fn check_auth(&self, req: &tiny_http::Request) -> bool {
        // Check Authorization header: "Bearer <token>"
        for h in req.headers() {
            let field_str: &str = h.field.as_str().as_ref();
            if field_str.eq_ignore_ascii_case("authorization") {
                let val: &str = h.value.as_str().as_ref();
                let trimmed = val.trim();
                if let Some(token_part) = trimmed.strip_prefix("Bearer ") {
                    if constant_time_equal(token_part.trim().as_bytes(), self.token.as_bytes()) {
                        return true;
                    }
                }
            }
        }
        false
    }

    fn handle_http_request(&self, mut req: tiny_http::Request) {
        let method = req.method().clone();
        let url = req.url().to_string();
        let path = url.split('?').next().unwrap_or("/");
        if method == Method::Options {
            // No browser cross-origin access: agents connect directly to loopback.
            self.respond_json(
                req,
                StatusCode(403),
                &serde_json::json!({"ok":false,"error":"Cross-origin browser access is disabled"}),
            );
            return;
        }
        if path == "/api/status" && method == Method::Get {
            let authenticated = self.check_auth(&req);
            self.respond_json(req, StatusCode(200), &serde_json::json!({"ok":true,"version":"1.2.0","protocol_version":2,"is_running":self.is_running.load(Ordering::SeqCst),"authenticated":authenticated,"port":self.port,"capabilities":["exec","jobs","uploads","audit"],"policy":*self.policy.lock().unwrap(),"audit_count":self.audit_logs.lock().unwrap().len(),"pending_approvals":self.pending_approvals.lock().unwrap().len(),"audit_error":self.audit_error.lock().unwrap().clone(),"max_command_bytes":crate::gateway_io::MAX_COMMAND,"max_chunk_bytes":crate::gateway_transfer::CHUNK,"job_log_mode":"bounded_streams","job_log_limit_bytes":8388608,"job_requires":"python3"}));
            return;
        }
        if !self.check_auth(&req) {
            self.audit_event(
                "authentication",
                "local-gateway",
                "HTTP authentication rejected",
                CommandRiskLevel::Safe,
                "denied",
                "denied",
                None,
                "认证失败；未执行",
                0,
            );
            self.respond_json(req,StatusCode(401),&serde_json::json!({"ok":false,"error":"Missing or invalid Bearer header; URL tokens are not accepted"}));
            return;
        }
        if req.headers().iter().any(|h| h.field.equiv("Origin")) {
            self.respond_json(
                req,
                StatusCode(403),
                &serde_json::json!({"ok":false,"error":"Browser-origin requests are disabled"}),
            );
            return;
        }
        if path == "/api/policy" {
            self.audit_event(
                "policy",
                "local-gateway",
                "HTTP policy change rejected",
                CommandRiskLevel::Mutation,
                "denied",
                "denied",
                None,
                "策略只能在桌面管理界面修改",
                0,
            );
            self.respond_json(req,StatusCode(403),&serde_json::json!({"ok":false,"error":"Change approval policy in the UltimateShell desktop UI"}));
            return;
        }
        let mut body = String::new();
        if req
            .body_length()
            .is_some_and(|n| n as u64 > crate::gateway_io::MAX_BODY)
        {
            self.respond_json(
                req,
                StatusCode(413),
                &serde_json::json!({"ok":false,"error":"Request body exceeds 1 MiB"}),
            );
            return;
        }
        if let Err(error) = req
            .as_reader()
            .take(crate::gateway_io::MAX_BODY + 1)
            .read_to_string(&mut body)
        {
            self.respond_json(
                req,
                StatusCode(400),
                &serde_json::json!({"ok":false,"error":error.to_string()}),
            );
            return;
        }
        if body.len() as u64 > crate::gateway_io::MAX_BODY {
            self.respond_json(
                req,
                StatusCode(413),
                &serde_json::json!({"ok":false,"error":"Request body exceeds 1 MiB"}),
            );
            return;
        }
        let value = if body.is_empty() {
            serde_json::json!({})
        } else {
            match serde_json::from_str(&body) {
                Ok(v) => v,
                Err(_) => {
                    self.respond_json(
                        req,
                        StatusCode(400),
                        &serde_json::json!({"ok":false,"error":"Invalid JSON"}),
                    );
                    return;
                }
            }
        };
        match self.dispatch_http(&method, path, &url, &value) {
            Ok(value) => self.respond_json(req, StatusCode(200), &value),
            Err(error) => {
                let parts: Vec<_> = path.trim_matches('/').split('/').collect();
                let id = parts
                    .get(2)
                    .copied()
                    .or_else(|| value.get("request_id").and_then(|v| v.as_str()));
                let uncertain = error.contains("未知")
                    || match (parts.get(1), id) {
                        (Some(&"uploads"), Some(id)) => crate::gateway_transfer::lookup(id)
                            .ok()
                            .flatten()
                            .is_some_and(|u| u.status == "committing"),
                        (Some(&"jobs"), Some(id)) => crate::gateway_jobs::lookup(id)
                            .ok()
                            .flatten()
                            .is_some_and(|j| {
                                ["starting", "running", "unknown"].contains(&j.status.as_str())
                            }),
                        _ => false,
                    };
                let code = if error.starts_with("busy:") {
                    409
                } else if error.starts_with("denied:") {
                    403
                } else if error.starts_with("timeout:") {
                    408
                } else if uncertain {
                    500
                } else if error.contains("Unknown endpoint") {
                    404
                } else {
                    400
                };
                self.respond_json(req,StatusCode(code),&serde_json::json!({"ok":false,"status":if uncertain{"unknown"}else{"error"},"error":redact_sensitive_output(&error)}))
            }
        }
    }

    fn dispatch_http(
        &self,
        method: &Method,
        path: &str,
        url: &str,
        value: &serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        use serde_json::json;
        if !self.is_running.load(Ordering::SeqCst) {
            return Err("Gateway stopped: request not executed".into());
        }
        if path == "/api/servers" && *method == Method::Get {
            return Ok(json!({"ok":true,"servers":self.get_available_servers()}));
        }
        if path == "/api/audit_logs" && *method == Method::Get {
            return Ok(
                json!({"ok":true,"logs":self.audit_logs.lock().map_err(|e|e.to_string())?.clone()}),
            );
        }
        let agent = value
            .get("agent")
            .or_else(|| value.get("agent_name"))
            .and_then(|v| v.as_str())
            .unwrap_or("AI Agent");
        if (path == "/api/exec" || path == "/api/read_file") && *method == Method::Post {
            let target = request_target(value)?;
            let command = if path == "/api/read_file" {
                let p = required_string(value, "path")?;
                format!("cat -- {}", crate::gateway_jobs::quote(p))
            } else {
                required_string(value, "command")?.to_string()
            };
            let (code, out, err) = self.execute_audited(&target, &command, agent)?;
            if path == "/api/read_file" {
                return Ok(
                    json!({"ok":code==0,"exit_code":code,"content":redact_sensitive_output(&out),"stderr":redact_sensitive_output(&err)}),
                );
            }
            return Ok(
                json!({"ok":code==0,"exit_code":code,"stdout":redact_sensitive_output(&out),"stderr":redact_sensitive_output(&err)}),
            );
        }
        if path.starts_with("/api/uploads") || path.starts_with("/api/jobs") {
            // Serialize state transitions, including launch/finalize. A timed-out client can safely query the same ID.
            let parts: Vec<_> = path.trim_matches('/').split('/').collect();
            let namespace = match parts.get(1) {
                Some(&"uploads") => "uploads",
                Some(&"jobs") => "jobs",
                _ => return Err("Unknown endpoint".into()),
            };
            let id = if parts.len() == 2 {
                required_string(value, "request_id")?
            } else {
                parts[2]
            };
            crate::gateway_transfer::valid_id(id)?;
            let _guard = if namespace == "uploads" && *method == Method::Get {
                None
            } else {
                Some(crate::gateway_state::lock(namespace, id)?)
            };
            if path == "/api/uploads" && *method == Method::Post {
                let target = self.canonical_target(&request_target(value)?)?;
                let identity = self.target_identity(&target)?;
                let id = required_string(value, "request_id")?;
                let dest = required_string(value, "path")?;
                let size = value
                    .get("size")
                    .and_then(|v| v.as_u64())
                    .ok_or("Missing size")?;
                let hash = required_string(value, "sha256")?;
                let overwrite = value
                    .get("overwrite")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                crate::gateway_transfer::valid_id(id)?;
                crate::gateway_transfer::validate_manifest(dest, size, hash)?;
                if let Some(u) = crate::gateway_transfer::lookup(id)? {
                    if u.path != dest
                        || u.size != size
                        || u.sha256 != hash.to_lowercase()
                        || u.overwrite != overwrite
                    {
                        return Err("request_id冲突".into());
                    }
                    self.check_target_identity(&target, &u.identity)?;
                    return Ok(json!({"ok":true,"upload":u}));
                }
                let summary = format!(
                    "upload {} bytes to {} SHA256={} overwrite={}",
                    size, dest, hash, overwrite
                );
                let source =
                    self.authorize(&target, &summary, CommandRiskLevel::Mutation, agent)?;
                self.check_target_identity(&target, &identity)?;
                let start = Instant::now();
                let result =
                    crate::gateway_transfer::create(self, id, &target, dest, size, hash, overwrite);
                self.audit_event_with_policy(
                    agent,
                    &target,
                    &summary,
                    CommandRiskLevel::Mutation,
                    &source.source,
                    if result.is_ok() { "success" } else { "error" },
                    None,
                    result
                        .as_ref()
                        .err()
                        .map(String::as_str)
                        .unwrap_or("上传会话已创建"),
                    start.elapsed().as_millis() as u64,
                    source.policy,
                );
                return result.map(|u| json!({"ok":true,"upload":u}));
            }
            if parts.get(1) == Some(&"uploads") && parts.len() >= 3 {
                let mut upload = crate::gateway_transfer::load(parts[2])?;
                self.check_target_identity(&upload.server, &upload.identity)?;
                if parts.len() == 3 && *method == Method::Get {
                    return Ok(json!({"ok":true,"upload":upload}));
                }
                if parts.len() == 3 && *method == Method::Delete {
                    if upload.status != "completed" && upload.status != "aborted" {
                        return Err("请先abort上传".into());
                    }
                    upload.cleaned = true;
                    crate::gateway_transfer::save(&upload)?;
                    return Ok(json!({"ok":true}));
                }
                if parts.len() == 4 && *method == Method::Post {
                    let operation = parts[3];
                    let mut summary =
                        format!("upload {} {} path={}", upload.id, operation, upload.path);
                    if operation == "chunk" {
                        use sha2::Digest;
                        let encoded = value.get("data").and_then(|v| v.as_str()).unwrap_or("");
                        summary.push_str(&format!(
                            " offset={} encoded_bytes={} encoded_sha256={:x}",
                            value
                                .get("offset")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(u64::MAX),
                            encoded.len(),
                            sha2::Sha256::digest(encoded.as_bytes())
                        ));
                    }

                    let start = Instant::now();
                    let result = match operation {
                        "chunk" => {
                            let offset = value
                                .get("offset")
                                .and_then(|v| v.as_u64())
                                .ok_or("Missing offset")?;
                            crate::gateway_transfer::chunk(
                                &mut upload,
                                offset,
                                required_string(value, "data")?,
                            )
                        }
                        "commit" => crate::gateway_transfer::commit(self, &mut upload),
                        "abort" => crate::gateway_transfer::abort(self, &mut upload),
                        _ => return Err("Unknown upload operation".into()),
                    };
                    self.audit_event(
                        agent,
                        &upload.server,
                        &summary,
                        CommandRiskLevel::Mutation,
                        "session",
                        if result.is_ok() {
                            "success"
                        } else if upload.status == "committing" {
                            "unknown"
                        } else {
                            "error"
                        },
                        None,
                        result.as_ref().err().map(String::as_str).unwrap_or("完成"),
                        start.elapsed().as_millis() as u64,
                    );
                    result?;
                    return Ok(json!({"ok":true,"upload":upload}));
                }
            }
            if path == "/api/jobs" && *method == Method::Post {
                let target = self.canonical_target(&request_target(value)?)?;
                let identity = self.target_identity(&target)?;
                let id = required_string(value, "request_id")?;
                let command = required_string(value, "command")?;
                crate::gateway_transfer::valid_id(id)?;
                crate::gateway_io::validate_command(command)?;
                if let Some(job) = crate::gateway_jobs::lookup(id)? {
                    use sha2::Digest;
                    let hash = format!("{:x}", sha2::Sha256::digest(command.as_bytes()));
                    if job.command_sha256 != hash {
                        return Err("request_id冲突".into());
                    }
                    self.check_target_identity(&target, &job.identity)?;
                    return Ok(json!({"ok":true,"job":job}));
                }
                let risk = classify_command(command);
                let source = self.authorize(&target, command, risk, agent)?;
                self.check_target_identity(&target, &identity)?;
                let start = Instant::now();
                let result = crate::gateway_jobs::create(self, id, &target, command);
                self.audit_event_with_policy(
                    agent,
                    &target,
                    command,
                    risk,
                    &source.source,
                    if result.is_ok() {
                        "running"
                    } else if crate::gateway_jobs::lookup(id)
                        .ok()
                        .flatten()
                        .is_some_and(|job| {
                            ["starting", "running", "unknown"].contains(&job.status.as_str())
                        })
                    {
                        "unknown"
                    } else {
                        "error"
                    },
                    None,
                    result
                        .as_ref()
                        .err()
                        .map(String::as_str)
                        .unwrap_or("后台任务已启动；使用任务ID查询退出码"),
                    start.elapsed().as_millis() as u64,
                    source.policy,
                );
                return result.map(|job| json!({"ok":true,"job":job}));
            }
            if parts.get(1) == Some(&"jobs") && parts.len() == 3 {
                let mut job = crate::gateway_jobs::load(parts[2])?;
                if *method == Method::Get {
                    let parameter = |key: &str| -> u64 {
                        url.split('?')
                            .nth(1)
                            .unwrap_or("")
                            .split('&')
                            .find_map(|s| {
                                s.strip_prefix(&format!("{key}="))
                                    .and_then(|n| n.parse().ok())
                            })
                            .unwrap_or(0)
                    };
                    let prior = job.status.clone();
                    let result = crate::gateway_jobs::poll(
                        self,
                        &mut job,
                        parameter("offset"),
                        parameter("stderr_offset"),
                    );
                    if job.status != prior || result.is_err() {
                        self.audit_event(
                            agent,
                            &job.server,
                            &format!("job {} poll", job.id),
                            CommandRiskLevel::Safe,
                            "session",
                            if result.is_err() {
                                "unknown"
                            } else {
                                &job.status
                            },
                            job.exit_code,
                            result
                                .as_ref()
                                .err()
                                .map(String::as_str)
                                .unwrap_or("任务状态已更新"),
                            0,
                        )
                    }
                    return result;
                }
                if *method == Method::Delete {
                    crate::gateway_jobs::cleanup(self, &mut job)?;
                    self.audit_event(
                        agent,
                        &job.server,
                        &format!("job {} cleanup", job.id),
                        CommandRiskLevel::Mutation,
                        "session",
                        "success",
                        None,
                        "已清理任务文件",
                        0,
                    );
                    return Ok(json!({"ok":true}));
                }
            }
        }
        Err("Unknown endpoint or method".into())
    }

    fn respond_json(&self, req: tiny_http::Request, status: StatusCode, json: &serde_json::Value) {
        let text = serde_json::to_string(json).unwrap_or_default();
        let response = Response::from_string(text)
            .with_status_code(status)
            .with_header(
                Header::from_bytes(
                    &b"Content-Type"[..],
                    &b"application/json; charset=utf-8"[..],
                )
                .unwrap(),
            );
        let _ = req.respond(response);
    }

    fn record_audit_log(&self, entry: AuditLogEntry) {
        let entry = crate::gateway_audit::sanitize(entry);
        let mut logs = self.audit_logs.lock().unwrap();
        logs.insert(0, entry.clone());
        logs.truncate(300);
        let mut pending = self.audit_pending.lock().unwrap();
        pending.push_back(entry);
        if pending.len() > 300 {
            pending.pop_front();
            self.audit_lost.fetch_add(1, Ordering::SeqCst);
        }
        let mut failure = None;
        while let Some(entry) = pending.front() {
            match crate::gateway_audit::append(&self.state_directory.join("audit.jsonl"), entry) {
                Ok(()) => {
                    pending.pop_front();
                }
                Err(e) => {
                    failure = Some(e);
                    break;
                }
            }
        }
        let lost = self.audit_lost.load(Ordering::SeqCst);
        *self.audit_error.lock().unwrap() = if lost > 0 {
            Some(format!(
                "审计缓存曾溢出{lost}条；{}",
                failure.unwrap_or_default()
            ))
        } else {
            failure.map(|error| format!("{error}；{}条等待落盘", pending.len()))
        };
        drop(pending);
        drop(logs);
        if let Some(app) = &self.app_handle {
            let _ = app.emit("agent_audit_updated", ());
        }
    }

    pub fn audit_event(
        &self,
        agent: &str,
        target: &str,
        command: &str,
        risk: CommandRiskLevel,
        source: &str,
        status: &str,
        exit: Option<i32>,
        output: &str,
        duration: u64,
    ) {
        let policy = *self.policy.lock().unwrap();
        self.audit_event_with_policy(
            agent, target, command, risk, source, status, exit, output, duration, policy,
        );
    }
    fn audit_event_with_policy(
        &self,
        agent: &str,
        target: &str,
        command: &str,
        risk: CommandRiskLevel,
        source: &str,
        status: &str,
        exit: Option<i32>,
        output: &str,
        duration: u64,
        policy: ApprovalPolicy,
    ) {
        self.record_audit_log(AuditLogEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            agent_name: agent.into(),
            server_target: target.into(),
            command: command.into(),
            risk_level: risk,
            policy_applied: policy,
            approved_by_user: source == "user",
            approval_source: source.into(),
            execution_phase: if status == "running" {
                "background_running"
            } else if status == "unknown" {
                "execution_unknown"
            } else if status == "denied" || status == "timeout" || source == "none" {
                "not_sent"
            } else {
                "completed"
            }
            .into(),
            status: status.into(),
            exit_code: exit,
            output_snippet: Some(output.into()),
            duration_ms: duration,
        });
    }
    pub fn set_policy_from_desktop(&self, policy: ApprovalPolicy) {
        let old = {
            let mut lock = self.policy.lock().unwrap();
            let old = *lock;
            *lock = policy;
            old
        };
        self.audit_event(
            "Desktop",
            "local-gateway",
            &format!("policy {:?} -> {:?}", old, policy),
            CommandRiskLevel::Mutation,
            "user",
            "success",
            Some(0),
            "桌面修改审批策略",
            0,
        );
    }
    pub fn clear_audit(&self) -> Result<(), String> {
        {
            let mut logs = self.audit_logs.lock().map_err(|e| e.to_string())?;
            crate::gateway_audit::clear(&self.state_directory.join("audit.jsonl"))?;
            logs.clear();
            self.audit_pending.lock().unwrap().clear();
            self.audit_lost.store(0, Ordering::SeqCst);
        }
        self.audit_event(
            "Desktop",
            "local-gateway",
            "clear audit",
            CommandRiskLevel::Mutation,
            "user",
            "success",
            Some(0),
            "用户清空审计历史",
            0,
        );
        Ok(())
    }
    fn authorize(
        &self,
        target: &str,
        command: &str,
        risk: CommandRiskLevel,
        agent: &str,
    ) -> Result<Grant, String> {
        if !self.is_running.load(Ordering::SeqCst) {
            return Err("Gateway stopped: request not executed".into());
        }
        let policy = *self.policy.lock().unwrap();
        if !needs_user_approval(risk, policy) {
            return Ok(Grant {
                source: "auto".into(),
                policy,
            });
        }
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::channel();
        {
            let mut pending = self.pending_approvals.lock().unwrap();
            if pending.len() >= 16 {
                return Err("待审批请求已达上限".into());
            }
            pending.insert(id.clone(), tx);
        }
        let payload = ApprovalRequestPayload {
            id: id.clone(),
            server_target: target.into(),
            command: command.into(),
            risk_level: risk,
            policy,
            timestamp: Local::now().format("%H:%M:%S").to_string(),
            expires_at_ms: (chrono::Utc::now().timestamp_millis() + 60000) as u64,
        };
        self.approval_requests
            .lock()
            .unwrap()
            .insert(id.clone(), payload.clone());
        if let Some(app) = &self.app_handle {
            if let Err(error) = app.emit("agent_approval_needed", payload) {
                self.pending_approvals.lock().unwrap().remove(&id);
                self.approval_requests.lock().unwrap().remove(&id);
                self.audit_event(
                    agent,
                    target,
                    command,
                    risk,
                    "none",
                    "error",
                    None,
                    "审批通知发送失败，未执行",
                    0,
                );
                return Err(format!("审批通知失败，未执行：{error}"));
            }
        }
        let outcome = rx.recv_timeout(Duration::from_secs(60));
        self.pending_approvals.lock().unwrap().remove(&id);
        self.approval_requests.lock().unwrap().remove(&id);
        if let Some(app) = &self.app_handle {
            let _ = app.emit("agent_approval_finished", &id);
        }
        match outcome {
            Ok(true) => Ok(Grant {
                source: "user".into(),
                policy,
            }),
            other => {
                let status = if other.is_err() { "timeout" } else { "denied" };
                self.audit_event(
                    agent,
                    target,
                    command,
                    risk,
                    status,
                    status,
                    None,
                    "未执行：审批拒绝或超时",
                    0,
                );
                Err(format!(
                    "{status}: request not executed; do not retry or switch transport to bypass approval"
                ))
            }
        }
    }
    fn execute_audited(
        &self,
        target: &str,
        command: &str,
        agent: &str,
    ) -> Result<(i32, String, String), String> {
        if let Err(e) = crate::gateway_io::validate_command(command) {
            self.audit_event(
                agent,
                target,
                command,
                classify_command(command),
                "none",
                "error",
                None,
                &e,
                0,
            );
            return Err(e);
        }
        let opts = self.resolve_target_opts(target)?;
        let risk = classify_command(command);
        let source = self.authorize(target, command, risk, agent)?;
        let start = Instant::now();
        let result = self.execute_with_options(&opts, command);
        match &result {
            Ok((code, out, err)) => self.audit_event_with_policy(
                agent,
                target,
                command,
                risk,
                &source.source,
                if *code == 0 { "success" } else { "error" },
                Some(*code),
                &format!(
                    "stdout: {}\nstderr: {}",
                    redact_sensitive_output(out)
                        .chars()
                        .take(1800)
                        .collect::<String>(),
                    redact_sensitive_output(err)
                        .chars()
                        .take(1800)
                        .collect::<String>()
                ),
                start.elapsed().as_millis() as u64,
                source.policy,
            ),
            Err(e) => self.audit_event_with_policy(
                agent,
                target,
                command,
                risk,
                &source.source,
                if e.contains("未知") {
                    "unknown"
                } else {
                    "error"
                },
                None,
                e,
                start.elapsed().as_millis() as u64,
                source.policy,
            ),
        }
        result
    }
    fn options_identity(o: &SpawnOptions) -> Result<String, String> {
        use sha2::{Digest, Sha256};
        Ok(format!(
            "v2:{:x}",
            Sha256::digest(
                serde_json::to_vec(&(
                    o.is_local,
                    &o.host,
                    o.port,
                    &o.username,
                    &o.host_id,
                    &o.identity_file,
                    &o.proxy_type,
                    &o.jump_host_id,
                    &o.proxy_url
                ))
                .map_err(|e| e.to_string())?
            )
        ))
    }
    fn identity_matches(opts: &SpawnOptions, expected: &str) -> Result<bool, String> {
        if expected.starts_with("v2:") {
            return Ok(Self::options_identity(opts)? == expected);
        }
        use sha2::Digest;
        let legacy = format!(
            "{:x}",
            sha2::Sha256::digest(
                serde_json::to_vec(&(
                    opts.is_local,
                    &opts.host,
                    opts.port,
                    &opts.username,
                    &opts.host_id
                ))
                .map_err(|e| e.to_string())?
            )
        );
        Ok(legacy == expected)
    }
    pub(crate) fn target_identity(&self, target: &str) -> Result<String, String> {
        Self::options_identity(&self.resolve_target_opts(target)?)
    }
    pub(crate) fn check_target_identity(&self, target: &str, identity: &str) -> Result<(), String> {
        if !Self::identity_matches(&self.resolve_target_opts(target)?, identity)? {
            return Err("目标服务器配置已改变，请重新授权创建会话".into());
        }
        Ok(())
    }
    pub(crate) fn with_sftp_bound<T>(
        &self,
        target: &str,
        identity: &str,
        operation: impl FnOnce(&ssh2::Sftp) -> Result<T, String>,
    ) -> Result<T, String> {
        self.with_sftp_checked(target, Some(identity), &self.control_connections, operation)
    }
    pub(crate) fn with_transfer_sftp_bound<T>(
        &self,
        target: &str,
        identity: &str,
        operation: impl FnOnce(&ssh2::Sftp) -> Result<T, String>,
    ) -> Result<T, String> {
        self.with_sftp_checked(
            target,
            Some(identity),
            &self.transfer_connections,
            operation,
        )
    }
    fn with_sftp_checked<T>(
        &self,
        target: &str,
        expected: Option<&str>,
        pool: &AgentConnections,
        operation: impl FnOnce(&ssh2::Sftp) -> Result<T, String>,
    ) -> Result<T, String> {
        let opts = self.resolve_target_opts(target)?;
        if expected.is_some_and(|id| !Self::identity_matches(&opts, id).unwrap_or(false)) {
            return Err("目标连接配置改变；操作未发送".into());
        }
        let lease = pool.acquire(&opts)?;
        let mut connection = lease.lock()?;
        let mut operation = Some(operation);
        for attempt in 0..2 {
            if !connection
                .as_ref()
                .is_some_and(ssh2::Session::authenticated)
            {
                *connection = Some(crate::sftp::connect_session(&opts)?);
            }
            let result = connection
                .as_ref()
                .unwrap()
                .sftp()
                .map_err(|e| e.to_string());
            match result {
                Ok(sftp) => {
                    let result = operation.take().unwrap()(&sftp);
                    drop(sftp);
                    if result.is_err() {
                        *connection = None;
                    }
                    return result;
                }
                Err(e) => {
                    *connection = None;
                    if attempt == 1 {
                        return Err(format!("SFTP通道创建失败；文件操作未发送：{e}"));
                    }
                }
            }
        }
        unreachable!()
    }

    pub fn get_available_servers(&self) -> Vec<ServerInfoPayload> {
        let mut result = Vec::new();

        // Always list local machine
        result.push(ServerInfoPayload {
            id: "local".to_string(),
            name: "本地系统 (Local Host)".to_string(),
            host: "127.0.0.1".to_string(),
            port: 0,
            username: std::env::var("USER").unwrap_or_else(|_| "local".to_string()),
            is_connected: true,
            is_local: true,
        });

        // 1. Active sessions from PtyManager
        let active_sessions = {
            let sessions = self.pty_mgr.sessions.lock().unwrap();
            sessions
                .iter()
                .map(|(sid, s)| (sid.clone(), s.opts.clone()))
                .collect::<Vec<_>>()
        };

        let mut seen_ids = std::collections::HashSet::new();

        for (sid, opts) in active_sessions {
            seen_ids.insert(opts.host_id.clone().unwrap_or_else(|| sid.clone()));
            result.push(ServerInfoPayload {
                id: sid,
                name: opts.host_name.unwrap_or_else(|| "活跃终端".to_string()),
                host: opts.host.unwrap_or_else(|| "127.0.0.1".to_string()),
                port: opts.port.unwrap_or(22),
                username: opts.username.unwrap_or_else(|| "root".to_string()),
                is_connected: true,
                is_local: opts.is_local,
            });
        }

        // 2. Saved host profiles from hosts.json
        for host in load_hosts() {
            if !seen_ids.contains(&host.id) {
                result.push(ServerInfoPayload {
                    id: host.id,
                    name: host.name,
                    host: host.host,
                    port: host.port,
                    username: host.username,
                    is_connected: false,
                    is_local: false,
                });
            }
        }

        result
    }

    pub(crate) fn resolve_target_opts(&self, target: &str) -> Result<SpawnOptions, String> {
        #[cfg(test)]
        if target == "fixture" {
            if let Some(opts) = TEST_REMOTE.with(|p| p.borrow().clone()) {
                return Ok(opts);
            }
        }
        let clean = target.trim().to_lowercase();
        if clean.is_empty() {
            return Err("目标服务器不能为空".into());
        }
        if clean == "local" || clean == "localhost" || clean == "本机" {
            return Ok(SpawnOptions {
                session_id: "local_gateway".into(),
                is_local: true,
                host_id: None,
                host_name: Some("本地终端".into()),
                host: Some("127.0.0.1".into()),
                port: None,
                username: None,
                identity_file: None,
                proxy_type: None,
                jump_host_id: None,
                proxy_url: None,
                cols: None,
                rows: None,
            });
        }
        let saved: Vec<_> = load_hosts()
            .into_iter()
            .map(|host| SpawnOptions {
                session_id: format!("auto_gw_{}", host.id),
                is_local: false,
                host_id: Some(host.id),
                host_name: Some(host.name),
                host: Some(host.host),
                port: Some(host.port),
                username: Some(host.username),
                identity_file: host.identity_file,
                proxy_type: host.proxy_type,
                jump_host_id: host.jump_host_id,
                proxy_url: host.proxy_url,
                cols: None,
                rows: None,
            })
            .collect();
        let active: Vec<_> = self
            .pty_mgr
            .sessions
            .lock()
            .map_err(|e| e.to_string())?
            .values()
            .map(|s| s.opts.clone())
            .collect();
        Self::select_target(&clean, &saved, &active)
    }
    fn select_target(
        clean: &str,
        saved: &[SpawnOptions],
        active: &[SpawnOptions],
    ) -> Result<SpawnOptions, String> {
        // An ID always outranks a label/IP. Duplicate labels never pick an arbitrary HashMap entry.
        if let Some(opts) = saved.iter().find(|o| {
            o.host_id
                .as_ref()
                .is_some_and(|id| id.to_lowercase() == clean)
        }) {
            return Ok(opts.clone());
        }
        if let Some(opts) = active.iter().find(|o| o.session_id.to_lowercase() == clean) {
            return Ok(opts.clone());
        }
        let mut matches = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for opts in saved.iter().chain(active) {
            if opts
                .host_name
                .as_ref()
                .is_some_and(|s| s.to_lowercase() == clean)
                || opts
                    .host
                    .as_ref()
                    .is_some_and(|s| s.to_lowercase() == clean)
            {
                let identity = Self::options_identity(opts)?;
                if seen.insert(identity) {
                    matches.push(opts.clone())
                }
            }
        }
        match matches.len() {
            0 => Err(format!("未找到目标「{clean}」，请查询/api/servers")),
            1 => Ok(matches.remove(0)),
            _ => Err(format!(
                "目标「{clean}」匹配多个账号/连接，请使用服务器ID或会话ID"
            )),
        }
    }
    fn canonical_target(&self, target: &str) -> Result<String, String> {
        let opts = self.resolve_target_opts(target)?;
        if opts.is_local {
            return Ok("local".into());
        }
        Ok(opts.host_id.unwrap_or(opts.session_id))
    }
    pub fn execute_on_target(
        &self,
        target: &str,
        command: &str,
    ) -> Result<(i32, String, String), String> {
        let opts = self.resolve_target_opts(target)?;
        self.execute_with_options(&opts, command)
    }
    pub(crate) fn execute_bound(
        &self,
        target: &str,
        identity: &str,
        command: &str,
    ) -> Result<(i32, String, String), String> {
        let opts = self.resolve_target_opts(target)?;
        if !Self::identity_matches(&opts, identity)? {
            return Err("目标配置改变，命令未发送".into());
        }
        self.execute_using_pool(&opts, command, &self.control_connections)
    }
    fn execute_with_options(
        &self,
        opts: &SpawnOptions,
        command: &str,
    ) -> Result<(i32, String, String), String> {
        self.execute_using_pool(opts, command, &self.connections)
    }
    fn execute_using_pool(
        &self,
        opts: &SpawnOptions,
        command: &str,
        pool: &AgentConnections,
    ) -> Result<(i32, String, String), String> {
        crate::gateway_io::validate_command(command)?;
        if opts.is_local {
            return crate::gateway_io::local(command);
        }

        // Opening a channel precedes exec, so a failed open can safely reconnect once.
        // Never replay exec/read failures: the remote command may already have run.
        let lease = pool.acquire(&opts)?;
        let mut connection = lease.lock()?;
        for attempt in 0..2 {
            if !connection
                .as_ref()
                .is_some_and(ssh2::Session::authenticated)
            {
                *connection = Some(crate::sftp::connect_session(&opts)?);
            }
            let sess = connection.as_ref().ok_or("AI SSH 连接未建立")?;
            let mut channel = match sess.channel_session() {
                Ok(channel) => channel,
                Err(error) => {
                    *connection = None;
                    if attempt == 0 {
                        continue;
                    }
                    return Err(format!(
                        "重新连接后仍无法创建 SSH 通道（命令未发送）：{error}"
                    ));
                }
            };
            let result = (|| -> Result<(i32, String, String), String> {
                channel
                    .exec(command)
                    .map_err(|e| format!("发送 SSH 命令失败，执行状态未知，不会自动重试：{e}"))?;
                channel
                    .send_eof()
                    .map_err(|e| format!("关闭命令输入失败，执行状态未知：{e}"))?;
                crate::gateway_io::collect(&mut channel, sess)
            })();
            if result.is_err() {
                drop(channel);
                *connection = None;
            }
            return result;
        }
        Err("无法创建 SSH 通道，命令未发送".into())
    }
}

#[derive(Clone)]
pub struct AgentSshServer {
    pub gateway: AgentGateway,
}

impl RusshServer for AgentSshServer {
    type Handler = AgentSshHandler;

    fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> Self::Handler {
        AgentSshHandler {
            gateway: self.gateway.clone(),
            target_user: String::new(),
        }
    }
}

pub struct AgentSshHandler {
    pub gateway: AgentGateway,
    pub target_user: String,
}

impl RusshHandler for AgentSshHandler {
    type Error = russh::Error;

    async fn channel_open_session(
        &mut self,
        _channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _session: &mut RusshSession,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        Ok(())
    }

    async fn auth_none(&mut self, _user: &str) -> Result<RusshAuth, Self::Error> {
        Ok(RusshAuth::reject())
    }
    async fn auth_password(
        &mut self,
        user: &str,
        password: &str,
    ) -> Result<RusshAuth, Self::Error> {
        if constant_time_equal(password.as_bytes(), self.gateway.token.as_bytes()) {
            self.target_user = user.into();
            Ok(RusshAuth::Accept)
        } else {
            self.gateway.audit_event(
                "Native SSH Client",
                "local-gateway",
                "SSH authentication rejected",
                CommandRiskLevel::Safe,
                "none",
                "denied",
                None,
                "SSH凭证无效",
                0,
            );
            Ok(RusshAuth::reject())
        }
    }
    async fn auth_publickey(
        &mut self,
        user: &str,
        key: VerifiedPublicKey<'_>,
    ) -> Result<RusshAuth, Self::Error> {
        if key
            .public_key
            .to_bytes()
            .is_ok_and(|bytes| constant_time_equal(&bytes, &self.gateway.client_public))
        {
            self.target_user = user.into();
            Ok(RusshAuth::Accept)
        } else {
            self.gateway.audit_event(
                "Native SSH Client",
                "local-gateway",
                "SSH public key rejected",
                CommandRiskLevel::Safe,
                "none",
                "denied",
                None,
                "调用方公钥未授权",
                0,
            );
            Ok(RusshAuth::reject())
        }
    }
    async fn pty_request(
        &mut self,
        channel: ChannelId,
        _term: &str,
        _col_width: u32,
        _row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        _modes: &[(russh::Pty, u32)],
        session: &mut RusshSession,
    ) -> Result<(), Self::Error> {
        session.channel_failure(channel)?;
        Ok(())
    }
    async fn shell_request(
        &mut self,
        channel: ChannelId,
        session: &mut RusshSession,
    ) -> Result<(), Self::Error> {
        self.gateway.audit_event(
            "Native SSH Client",
            &self.target_user,
            "interactive shell",
            CommandRiskLevel::Mutation,
            "none",
            "error",
            None,
            "此入口仅支持ssh <command>；上传使用HTTP /api/uploads，长任务使用/api/jobs",
            0,
        );
        session.channel_failure(channel)?;
        session.close(channel)?;
        Ok(())
    }
    async fn data(
        &mut self,
        channel: ChannelId,
        _data: &[u8],
        session: &mut RusshSession,
    ) -> Result<(), Self::Error> {
        // This endpoint does not forward stdin. State the unsupported capability, never silently drop a file.
        session.extended_data(
            channel,
            1,
            b"stdin forwarding is unavailable; use HTTP /api/uploads or /api/jobs.\n".to_vec(),
        )?;
        Ok(())
    }
    async fn subsystem_request(
        &mut self,
        channel: ChannelId,
        name: &str,
        session: &mut RusshSession,
    ) -> Result<(), Self::Error> {
        self.gateway.audit_event(
            "Native SSH Client",
            &self.target_user,
            &format!("subsystem {name}"),
            CommandRiskLevel::Mutation,
            "none",
            "error",
            None,
            "不支持SFTP子系统；请使用HTTP /api/uploads，不要将发布包塞入命令",
            0,
        );
        session.channel_failure(channel)?;
        session.extended_data(
            channel,
            1,
            b"SFTP subsystem unavailable; use HTTP /api/uploads.\n".to_vec(),
        )?;
        session.close(channel)?;
        Ok(())
    }
    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut RusshSession,
    ) -> Result<(), Self::Error> {
        if self.gateway.work_requests.fetch_add(1, Ordering::SeqCst) >= 8 {
            self.gateway.work_requests.fetch_sub(1, Ordering::SeqCst);
            session.channel_failure(channel)?;
            return Ok(());
        }
        let work_slot = RequestSlot(self.gateway.work_requests.clone());
        if self.gateway.active_requests.fetch_add(1, Ordering::SeqCst) >= 16 {
            self.gateway.active_requests.fetch_sub(1, Ordering::SeqCst);
            session.channel_failure(channel)?;
            return Ok(());
        }
        let slot = RequestSlot(self.gateway.active_requests.clone());
        let cmd = match std::str::from_utf8(data) {
            Ok(s) => s.trim().to_string(),
            Err(_) => {
                session.channel_failure(channel)?;
                return Ok(());
            }
        };
        if cmd.is_empty() {
            session.channel_failure(channel)?;
            return Ok(());
        }
        session.channel_success(channel)?;
        let gateway = self.gateway.clone();
        let target = self.target_user.clone();
        session.extended_data(
            channel,
            1,
            b"[UltimateShell] Request received; approval may be required in the desktop app.\n"
                .to_vec(),
        )?;
        let result = tokio::task::spawn_blocking(move || {
            let _slot = slot;
            let _work = work_slot;
            gateway.scoped_state(|| gateway.execute_audited(&target, &cmd, "Native SSH Client"))
        })
        .await;
        match result {
            Ok(Ok((code, out, err))) => {
                session.data(channel, redact_sensitive_output(&out).into_bytes())?;
                session.extended_data(channel, 1, redact_sensitive_output(&err).into_bytes())?;
                session.exit_status_request(channel, code as u32)?;
            }
            other => {
                let error = match other {
                    Ok(Err(e)) => e,
                    Err(e) => e.to_string(),
                    _ => unreachable!(),
                };
                session.extended_data(channel, 1, redact_sensitive_output(&error).into_bytes())?;
                session.exit_status_request(channel, 1)?;
            }
        }
        session.eof(channel)?;
        session.close(channel)?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "agent_gateway_tests.rs"]
mod tests;
