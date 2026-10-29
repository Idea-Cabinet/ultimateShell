use chrono::Local;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Method, Response, Server, StatusCode};

use crate::hosts::load_hosts;
use crate::pty::{PtyManager, SpawnOptions};
use crate::sftp::SftpPool;

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayStatusPayload {
    pub is_running: bool,
    pub port: u16,
    pub token: String,
    pub policy: ApprovalPolicy,
    pub active_servers_count: usize,
    pub audit_count: usize,
    pub pending_approvals_count: usize,
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
    let trimmed = cmd.trim();
    if trimmed.is_empty() {
        return CommandRiskLevel::Safe;
    }

    let lower = trimmed.to_lowercase();

    // L2: Critical high-risk commands (Destruction / crash / wipe)
    let critical_patterns = [
        "rm -rf",
        "rm -fr",
        "rm -r -f",
        "rm -f -r",
        "mkfs",
        "fdisk",
        "parted",
        "dd if=",
        "dd of=",
        ":(){ :|:& };:",
        "reboot",
        "shutdown",
        "init 0",
        "init 6",
        "halt",
        "poweroff",
        "iptables -f",
        "ufw disable",
        "firewall-cmd --panic-on",
        "chmod -r 777",
        "chmod 777 /",
        "> /dev/sda",
        "> /dev/nvme",
        "drop database",
        "drop table",
        "truncate table",
    ];
    for p in critical_patterns {
        if lower.contains(p) {
            return CommandRiskLevel::Critical;
        }
    }

    // L1: Standard mutations (Modifications, writes, service restarts)
    let mutation_keywords = [
        "rm ",
        "rmdir ",
        "touch ",
        "mkdir ",
        "cp ",
        "mv ",
        "sed -i",
        "awk -i",
        "chmod ",
        "chown ",
        "chgrp ",
        "systemctl restart",
        "systemctl stop",
        "systemctl reload",
        "systemctl enable",
        "systemctl disable",
        "systemctl mask",
        "service ",
        "/etc/init.d/",
        "kill ",
        "pkill ",
        "killall ",
        "docker restart",
        "docker stop",
        "docker rm",
        "docker rmi",
        "docker kill",
        "docker-compose down",
        "docker compose down",
        "apt install",
        "apt-get install",
        "apt remove",
        "apt purge",
        "yum install",
        "yum remove",
        "dnf install",
        "dnf remove",
        "npm install -g",
        "pip install",
    ];
    for m in mutation_keywords {
        if lower.contains(m) {
            return CommandRiskLevel::Mutation;
        }
    }

    // Redirection writes e.g. "echo 'a' > file"
    if trimmed.contains('>') {
        return CommandRiskLevel::Mutation;
    }

    // L0: Read-only / Query safe by default
    CommandRiskLevel::Safe
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
    let mut out = raw.to_string();
    if out.contains("PRIVATE KEY-----") {
        return "[REDACTED PRIVATE KEY CONTENT]".to_string();
    }
    // Redact password=xxx patterns
    let password_patterns = ["password=", "passwd=", "secret=", "token=", "key="];
    for p in password_patterns {
        let mut start_idx = 0;
        while let Some(idx) = out[start_idx..].to_lowercase().find(p) {
            let actual_idx = start_idx + idx + p.len();
            let end_idx = out[actual_idx..]
                .find(|c: char| c == ' ' || c == '\n' || c == '&' || c == ';' || c == '"' || c == '\'')
                .map(|e| actual_idx + e)
                .unwrap_or(out.len());
            if actual_idx < end_idx {
                out.replace_range(actual_idx..end_idx, "***");
                start_idx = actual_idx + 3;
            } else {
                break;
            }
        }
    }
    out
}

#[derive(Clone)]
pub struct AgentGateway {
    pub port: u16,
    pub token: String,
    pub policy: Arc<Mutex<ApprovalPolicy>>,
    pub is_running: Arc<AtomicBool>,
    pub pending_approvals: Arc<Mutex<HashMap<String, mpsc::Sender<bool>>>>,
    pub audit_logs: Arc<Mutex<Vec<AuditLogEntry>>>,
    pub pty_mgr: PtyManager,
    pub sftp_pool: SftpPool,
    pub app_handle: AppHandle,
}

impl AgentGateway {
    pub fn new(pty_mgr: PtyManager, sftp_pool: SftpPool, app_handle: AppHandle) -> Self {
        // Generate a random bearer token for this app session
        let token = format!("us_gate_{}", uuid::Uuid::new_v4().to_string().replace('-', ""));
        let port = 39281;

        Self {
            port,
            token,
            policy: Arc::new(Mutex::new(ApprovalPolicy::Smart)), // Default: "帮我批准"
            is_running: Arc::new(AtomicBool::new(false)),
            pending_approvals: Arc::new(Mutex::new(HashMap::new())),
            audit_logs: Arc::new(Mutex::new(Vec::new())),
            pty_mgr,
            sftp_pool,
            app_handle,
        }
    }

    pub fn start_server(&self) {
        if self.is_running.load(Ordering::SeqCst) {
            return;
        }

        let gateway = self.clone();
        gateway.is_running.store(true, Ordering::SeqCst);

        thread::spawn(move || {
            let addr = format!("127.0.0.1:{}", gateway.port);
            let server = match Server::http(&addr) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[AgentGateway] 无法绑定本地网关端口 {}: {}", addr, e);
                    gateway.is_running.store(false, Ordering::SeqCst);
                    return;
                }
            };

            println!("[AgentGateway] 本地 AI 安全网关已启动在 http://{}", addr);

            while gateway.is_running.load(Ordering::SeqCst) {
                match server.recv() {
                    Ok(request) => {
                        let gw_clone = gateway.clone();
                        thread::spawn(move || {
                            gw_clone.handle_http_request(request);
                        });
                    }
                    Err(e) => {
                        if gateway.is_running.load(Ordering::SeqCst) {
                            eprintln!("[AgentGateway] 接收请求异常: {}", e);
                        }
                        break;
                    }
                }
            }
        });
    }

    pub fn stop_server(&self) {
        self.is_running.store(false, Ordering::SeqCst);
    }

    fn check_auth(&self, req: &tiny_http::Request) -> bool {
        // Check Authorization header: "Bearer <token>"
        for h in req.headers() {
            let field_str: &str = h.field.as_str().as_ref();
            if field_str.eq_ignore_ascii_case("authorization") {
                let val: &str = h.value.as_str().as_ref();
                let trimmed = val.trim();
                if let Some(token_part) = trimmed.strip_prefix("Bearer ") {
                    if token_part.trim() == self.token {
                        return true;
                    }
                }
            }
        }
        // Fallback: check query parameter ?token=...
        let url = req.url();
        if let Some(pos) = url.find("token=") {
            let token_query = &url[pos + 6..];
            let token_val = token_query.split('&').next().unwrap_or("");
            if token_val == self.token {
                return true;
            }
        }
        false
    }

    fn handle_http_request(&self, mut req: tiny_http::Request) {
        let method = req.method().clone();
        let raw_url = req.url().to_string();
        let path = raw_url.split('?').next().unwrap_or("/").to_string();

        // 1. Handle CORS Preflight OPTIONS
        if method == Method::Options {
            let response = Response::empty(StatusCode(204))
                .with_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap())
                .with_header(
                    Header::from_bytes(
                        &b"Access-Control-Allow-Methods"[..],
                        &b"GET, POST, OPTIONS"[..],
                    )
                    .unwrap(),
                )
                .with_header(
                    Header::from_bytes(
                        &b"Access-Control-Allow-Headers"[..],
                        &b"Content-Type, Authorization"[..],
                    )
                    .unwrap(),
                );
            let _ = req.respond(response);
            return;
        }

        // 2. Health & Status check (can be accessed without token to check if Gateway is running)
        if path == "/api/status" && method == Method::Get {
            let policy = *self.policy.lock().unwrap();
            let is_auth = self.check_auth(&req);
            let audit_count = self.audit_logs.lock().unwrap().len();
            let pending_count = self.pending_approvals.lock().unwrap().len();

            let json = serde_json::json!({
                "ok": true,
                "version": "1.0.0",
                "is_running": true,
                "port": self.port,
                "policy": policy,
                "authenticated": is_auth,
                "audit_count": audit_count,
                "pending_approvals": pending_count,
            });
            self.respond_json(req, StatusCode(200), &json);
            return;
        }

        // 3. For all other endpoints, enforce Bearer Token authentication
        if !self.check_auth(&req) {
            let err_json = serde_json::json!({
                "ok": false,
                "error": "Unauthorized: Invalid or missing Agent Bearer Token. Please provide 'Authorization: Bearer <token>'",
            });
            self.respond_json(req, StatusCode(401), &err_json);
            return;
        }

        // 4. GET /api/servers (List available active tabs & saved servers without credentials)
        if path == "/api/servers" && method == Method::Get {
            let list = self.get_available_servers();
            let json = serde_json::json!({
                "ok": true,
                "servers": list,
            });
            self.respond_json(req, StatusCode(200), &json);
            return;
        }

        // 5. POST /api/policy (Update policy: "strict", "smart", "auto")
        if path == "/api/policy" && method == Method::Post {
            let mut body = String::new();
            if req.as_reader().read_to_string(&mut body).is_ok() {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(p) = val.get("policy").and_then(|v| v.as_str()) {
                        let new_policy = match p {
                            "strict" => ApprovalPolicy::Strict,
                            "auto" => ApprovalPolicy::Auto,
                            _ => ApprovalPolicy::Smart,
                        };
                        *self.policy.lock().unwrap() = new_policy;
                        let json = serde_json::json!({
                            "ok": true,
                            "policy": new_policy,
                        });
                        self.respond_json(req, StatusCode(200), &json);
                        return;
                    }
                }
            }
            self.respond_json(
                req,
                StatusCode(400),
                &serde_json::json!({ "ok": false, "error": "Invalid request body" }),
            );
            return;
        }

        // 6. GET /api/audit_logs (Get recent audit history)
        if path == "/api/audit_logs" && method == Method::Get {
            let logs = self.audit_logs.lock().unwrap().clone();
            let json = serde_json::json!({
                "ok": true,
                "logs": logs,
            });
            self.respond_json(req, StatusCode(200), &json);
            return;
        }

        // 7. POST /api/exec (Execute remote or local command with policy check & approval)
        if path == "/api/exec" && method == Method::Post {
            let mut body = String::new();
            if let Err(e) = req.as_reader().read_to_string(&mut body) {
                self.respond_json(
                    req,
                    StatusCode(400),
                    &serde_json::json!({ "ok": false, "error": format!("Read body error: {}", e) }),
                );
                return;
            }

            let payload: serde_json::Value = match serde_json::from_str(&body) {
                Ok(v) => v,
                Err(e) => {
                    self.respond_json(
                        req,
                        StatusCode(400),
                        &serde_json::json!({ "ok": false, "error": format!("Invalid JSON: {}", e) }),
                    );
                    return;
                }
            };

            let target = payload
                .get("target")
                .and_then(|v| v.as_str())
                .unwrap_or("local")
                .trim()
                .to_string();
            let command = match payload.get("command").and_then(|v| v.as_str()) {
                Some(cmd) if !cmd.trim().is_empty() => cmd.trim().to_string(),
                _ => {
                    self.respond_json(
                        req,
                        StatusCode(400),
                        &serde_json::json!({ "ok": false, "error": "Missing 'command' field" }),
                    );
                    return;
                }
            };
            let agent_name = payload
                .get("agent")
                .and_then(|v| v.as_str())
                .unwrap_or("AI Agent")
                .to_string();

            // Perform Command Classification & Approval Check
            let risk = classify_command(&command);
            let current_policy = *self.policy.lock().unwrap();
            let needs_approval = needs_user_approval(risk, current_policy);

            let mut approved_by_user = !needs_approval;

            if needs_approval {
                let approval_id = uuid::Uuid::new_v4().to_string();
                let (tx, rx) = mpsc::channel::<bool>();

                {
                    let mut pending = self.pending_approvals.lock().unwrap();
                    pending.insert(approval_id.clone(), tx);
                }

                // Notify frontend via Tauri Event
                let req_payload = ApprovalRequestPayload {
                    id: approval_id.clone(),
                    server_target: target.clone(),
                    command: command.clone(),
                    risk_level: risk,
                    policy: current_policy,
                    timestamp: Local::now().format("%H:%M:%S").to_string(),
                };
                let _ = self.app_handle.emit("agent_approval_needed", req_payload);

                // Wait for user click in GUI (with 60-second timeout)
                approved_by_user = match rx.recv_timeout(Duration::from_secs(60)) {
                    Ok(val) => val,
                    Err(_) => {
                        // Timeout: clean up and reject
                        let mut pending = self.pending_approvals.lock().unwrap();
                        pending.remove(&approval_id);
                        false
                    }
                };
            }

            if !approved_by_user {
                // Operation denied by user
                self.record_audit_log(AuditLogEntry {
                    id: uuid::Uuid::new_v4().to_string(),
                    timestamp: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                    agent_name,
                    server_target: target.clone(),
                    command: command.clone(),
                    risk_level: risk,
                    policy_applied: current_policy,
                    approved_by_user: false,
                    status: "denied".to_string(),
                    exit_code: None,
                    output_snippet: Some("操作已被用户拒绝或审批超时".to_string()),
                    duration_ms: 0,
                });

                let err_json = serde_json::json!({
                    "ok": false,
                    "error": "Operation rejected by user (approval denied or timed out)",
                    "risk_level": risk,
                    "target": target,
                    "command": command,
                });
                self.respond_json(req, StatusCode(403), &err_json);
                return;
            }

            // User approved (or auto approved): Execute command!
            let start_time = Instant::now();
            let exec_result = self.execute_on_target(&target, &command);
            let duration_ms = start_time.elapsed().as_millis() as u64;

            match exec_result {
                Ok((exit_code, stdout, stderr)) => {
                    let clean_stdout = redact_sensitive_output(&stdout);
                    let clean_stderr = redact_sensitive_output(&stderr);
                    let snippet = if !clean_stdout.is_empty() {
                        clean_stdout.chars().take(200).collect::<String>()
                    } else {
                        clean_stderr.chars().take(200).collect::<String>()
                    };

                    self.record_audit_log(AuditLogEntry {
                        id: uuid::Uuid::new_v4().to_string(),
                        timestamp: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                        agent_name,
                        server_target: target.clone(),
                        command,
                        risk_level: risk,
                        policy_applied: current_policy,
                        approved_by_user: true,
                        status: "executed".to_string(),
                        exit_code: Some(exit_code),
                        output_snippet: Some(snippet),
                        duration_ms,
                    });

                    let json = serde_json::json!({
                        "ok": true,
                        "exit_code": exit_code,
                        "stdout": clean_stdout,
                        "stderr": clean_stderr,
                        "duration_ms": duration_ms,
                        "risk_level": risk,
                    });
                    self.respond_json(req, StatusCode(200), &json);
                }
                Err(err_msg) => {
                    self.record_audit_log(AuditLogEntry {
                        id: uuid::Uuid::new_v4().to_string(),
                        timestamp: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                        agent_name,
                        server_target: target.clone(),
                        command,
                        risk_level: risk,
                        policy_applied: current_policy,
                        approved_by_user: true,
                        status: "failed".to_string(),
                        exit_code: None,
                        output_snippet: Some(err_msg.clone()),
                        duration_ms,
                    });

                    let json = serde_json::json!({
                        "ok": false,
                        "error": err_msg,
                        "duration_ms": duration_ms,
                    });
                    self.respond_json(req, StatusCode(500), &json);
                }
            }
            return;
        }

        // 8. POST /api/read_file (Read remote or local file content)
        if path == "/api/read_file" && method == Method::Post {
            let mut body = String::new();
            if let Err(e) = req.as_reader().read_to_string(&mut body) {
                self.respond_json(
                    req,
                    StatusCode(400),
                    &serde_json::json!({ "ok": false, "error": format!("Read body error: {}", e) }),
                );
                return;
            }

            let payload: serde_json::Value = match serde_json::from_str(&body) {
                Ok(v) => v,
                Err(e) => {
                    self.respond_json(
                        req,
                        StatusCode(400),
                        &serde_json::json!({ "ok": false, "error": format!("Invalid JSON: {}", e) }),
                    );
                    return;
                }
            };

            let target = payload
                .get("target")
                .and_then(|v| v.as_str())
                .unwrap_or("local")
                .trim()
                .to_string();
            let file_path = match payload.get("path").and_then(|v| v.as_str()) {
                Some(p) if !p.trim().is_empty() => p.trim().to_string(),
                _ => {
                    self.respond_json(
                        req,
                        StatusCode(400),
                        &serde_json::json!({ "ok": false, "error": "Missing 'path' field" }),
                    );
                    return;
                }
            };

            // Read file content via target cat
            let safe_cat_cmd = format!("cat '{}' 2>&1", file_path.replace('\'', "'\\''"));
            match self.execute_on_target(&target, &safe_cat_cmd) {
                Ok((exit_code, stdout, stderr)) => {
                    if exit_code == 0 {
                        let clean = redact_sensitive_output(&stdout);
                        let json = serde_json::json!({
                            "ok": true,
                            "path": file_path,
                            "content": clean,
                        });
                        self.respond_json(req, StatusCode(200), &json);
                    } else {
                        let json = serde_json::json!({
                            "ok": false,
                            "error": format!("Failed to read file: {}{}", stdout, stderr),
                        });
                        self.respond_json(req, StatusCode(404), &json);
                    }
                }
                Err(e) => {
                    self.respond_json(
                        req,
                        StatusCode(500),
                        &serde_json::json!({ "ok": false, "error": e }),
                    );
                }
            }
            return;
        }

        // 404 for unknown endpoints
        self.respond_json(
            req,
            StatusCode(404),
            &serde_json::json!({ "ok": false, "error": "Endpoint not found" }),
        );
    }

    fn respond_json(&self, req: tiny_http::Request, status: StatusCode, json: &serde_json::Value) {
        let text = serde_json::to_string(json).unwrap_or_default();
        let response = Response::from_string(text)
            .with_status_code(status)
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json; charset=utf-8"[..])
                    .unwrap(),
            )
            .with_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap());
        let _ = req.respond(response);
    }

    fn record_audit_log(&self, entry: AuditLogEntry) {
        let mut logs = self.audit_logs.lock().unwrap();
        logs.insert(0, entry);
        if logs.len() > 300 {
            logs.truncate(300);
        }
        // Emit update to frontend
        let _ = self.app_handle.emit("agent_audit_updated", ());
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

    fn resolve_target_opts(&self, target: &str) -> Result<SpawnOptions, String> {
        let clean = target.trim().to_lowercase();
        if clean == "local" || clean == "localhost" || clean == "本机" {
            return Ok(SpawnOptions {
                session_id: "local_gateway".to_string(),
                is_local: true,
                host_id: None,
                host_name: Some("本地终端".to_string()),
                host: Some("127.0.0.1".to_string()),
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

        // Search in active PTY sessions first
        {
            let sessions = self.pty_mgr.sessions.lock().unwrap();
            for (sid, s) in sessions.iter() {
                let name = s.opts.host_name.as_deref().unwrap_or("").to_lowercase();
                let host = s.opts.host.as_deref().unwrap_or("").to_lowercase();
                if sid.to_lowercase() == clean || name == clean || host == clean || name.contains(&clean) {
                    return Ok(s.opts.clone());
                }
            }
        }

        // Search in saved hosts
        for host in load_hosts() {
            let name = host.name.to_lowercase();
            let h_ip = host.host.to_lowercase();
            if host.id.to_lowercase() == clean || name == clean || h_ip == clean || name.contains(&clean) {
                return Ok(SpawnOptions {
                    session_id: format!("auto_gw_{}", host.id),
                    is_local: false,
                    host_id: Some(host.id.clone()),
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
                });
            }
        }

        Err(format!(
            "未找到匹配的目标服务器「{}」。请使用 /api/servers 查询可用列表",
            target
        ))
    }

    pub fn execute_on_target(
        &self,
        target: &str,
        command: &str,
    ) -> Result<(i32, String, String), String> {
        let opts = self.resolve_target_opts(target)?;

        if opts.is_local {
            let output = std::process::Command::new("sh")
                .arg("-c")
                .arg(command)
                .output()
                .map_err(|e| format!("本地命令执行错误: {}", e))?;

            let exit_code = output.status.code().unwrap_or(-1);
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Ok((exit_code, stdout, stderr));
        }

        // Remote SSH Execution via SftpPool
        let sess_arc = self.sftp_pool.get_or_connect(&opts)?;
        let sess = sess_arc.lock().map_err(|e| e.to_string())?;

        let mut channel = sess
            .channel_session()
            .map_err(|e| format!("无法创建 SSH 通道: {}", e))?;

        channel
            .exec(command)
            .map_err(|e| format!("执行命令失败: {}", e))?;

        let mut stdout = String::new();
        channel.read_to_string(&mut stdout).ok();

        let mut stderr = String::new();
        channel.stderr().read_to_string(&mut stderr).ok();

        channel.wait_close().ok();
        let exit_code = channel.exit_status().unwrap_or(0);

        Ok((exit_code, stdout, stderr))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_risk_classification() {
        assert_eq!(classify_command("ps aux"), CommandRiskLevel::Safe);
        assert_eq!(classify_command("cat /etc/nginx/nginx.conf"), CommandRiskLevel::Safe);
        assert_eq!(classify_command("systemctl status nginx"), CommandRiskLevel::Safe);
        assert_eq!(classify_command("uptime"), CommandRiskLevel::Safe);

        assert_eq!(classify_command("systemctl restart nginx"), CommandRiskLevel::Mutation);
        assert_eq!(classify_command("docker restart web"), CommandRiskLevel::Mutation);
        assert_eq!(classify_command("mkdir -p /data/logs"), CommandRiskLevel::Mutation);
        assert_eq!(classify_command("chmod 755 /var/www"), CommandRiskLevel::Mutation);

        assert_eq!(classify_command("rm -rf /var/www"), CommandRiskLevel::Critical);
        assert_eq!(classify_command("mkfs.ext4 /dev/sdb1"), CommandRiskLevel::Critical);
        assert_eq!(classify_command("iptables -F"), CommandRiskLevel::Critical);
        assert_eq!(classify_command("reboot"), CommandRiskLevel::Critical);
    }

    #[test]
    fn test_policy_approvals() {
        // Strict: mutations and critical require approval, safe passes
        assert_eq!(needs_user_approval(CommandRiskLevel::Safe, ApprovalPolicy::Strict), false);
        assert_eq!(needs_user_approval(CommandRiskLevel::Mutation, ApprovalPolicy::Strict), true);
        assert_eq!(needs_user_approval(CommandRiskLevel::Critical, ApprovalPolicy::Strict), true);

        // Smart: only critical requires approval
        assert_eq!(needs_user_approval(CommandRiskLevel::Safe, ApprovalPolicy::Smart), false);
        assert_eq!(needs_user_approval(CommandRiskLevel::Mutation, ApprovalPolicy::Smart), false);
        assert_eq!(needs_user_approval(CommandRiskLevel::Critical, ApprovalPolicy::Smart), true);

        // Auto: all pass
        assert_eq!(needs_user_approval(CommandRiskLevel::Safe, ApprovalPolicy::Auto), false);
        assert_eq!(needs_user_approval(CommandRiskLevel::Mutation, ApprovalPolicy::Auto), false);
        assert_eq!(needs_user_approval(CommandRiskLevel::Critical, ApprovalPolicy::Auto), false);
    }

    #[test]
    fn test_redaction() {
        let input = "Server responded with password=SuperSecret123&token=abcde456; and done";
        let redacted = redact_sensitive_output(input);
        assert!(!redacted.contains("SuperSecret123"));
        assert!(!redacted.contains("abcde456"));
        assert!(redacted.contains("***"));
    }
}
