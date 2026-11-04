use super::*;

#[test]
fn gateway_token_is_persistent_private_and_never_silently_rotated() {
    let dir = std::env::temp_dir().join(format!("us-gateway-token-{}", uuid::Uuid::new_v4()));
    let path = dir.join("token");
    let first = load_gateway_token(&path).unwrap();
    assert!(first.starts_with("us_gate_"));
    assert_eq!(load_gateway_token(&path).unwrap(), first);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    std::fs::write(&path, "invalid").unwrap();
    assert!(load_gateway_token(&path).is_err());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "invalid");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn gateway_target_never_defaults_to_local() {
    use serde_json::json;
    assert_eq!(request_target(&json!({"server":"3.6"})).unwrap(), "3.6");
    assert_eq!(request_target(&json!({"target":" 3.6 "})).unwrap(), "3.6");
    assert_eq!(request_target(&json!({"target":"local"})).unwrap(), "local");
    assert_eq!(
        request_target(&json!({"target":"3.6", "server":"3.6"})).unwrap(),
        "3.6"
    );
    for value in [
        json!({}),
        json!({"server":""}),
        json!({"target":null}),
        json!({"target":3}),
        json!({"target":"local","server":"3.6"}),
    ] {
        assert!(request_target(&value).is_err());
    }
}

#[test]
fn gateway_host_key_survives_restart_and_rejects_corruption() {
    let dir = std::env::temp_dir().join(format!("us-gateway-key-{}", uuid::Uuid::new_v4()));
    let path = dir.join("host_ed25519");
    let first = load_gateway_host_key(&path).unwrap();
    let second = load_gateway_host_key(&path).unwrap();
    assert_eq!(first.public_key(), second.public_key());
    let published = russh::keys::PublicKey::read_openssh_file(path.with_extension("pub")).unwrap();
    assert_eq!(first.public_key(), &published);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }
    std::fs::write(&path, "damaged-key").unwrap();
    assert!(load_gateway_host_key(&path).is_err());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "damaged-key");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn test_risk_classification() {
    assert_eq!(classify_command("ps aux"), CommandRiskLevel::Safe);
    assert_eq!(
        classify_command("cat /etc/nginx/nginx.conf"),
        CommandRiskLevel::Safe
    );
    assert_eq!(
        classify_command("systemctl status nginx"),
        CommandRiskLevel::Safe
    );
    assert_eq!(classify_command("uptime"), CommandRiskLevel::Safe);

    assert_eq!(
        classify_command("systemctl restart nginx"),
        CommandRiskLevel::Mutation
    );
    assert_eq!(
        classify_command("docker restart web"),
        CommandRiskLevel::Mutation
    );
    assert_eq!(
        classify_command("mkdir -p /data/logs"),
        CommandRiskLevel::Mutation
    );
    assert_eq!(
        classify_command("chmod 755 /var/www"),
        CommandRiskLevel::Mutation
    );

    assert_eq!(
        classify_command("rm -rf /var/www"),
        CommandRiskLevel::Critical
    );
    assert_eq!(
        classify_command("mkfs.ext4 /dev/sdb1"),
        CommandRiskLevel::Critical
    );
    assert_eq!(classify_command("iptables -F"), CommandRiskLevel::Critical);
    assert_eq!(classify_command("reboot"), CommandRiskLevel::Critical);
}

#[test]
fn test_policy_approvals() {
    // Strict: mutations and critical require approval, safe passes
    assert_eq!(
        needs_user_approval(CommandRiskLevel::Safe, ApprovalPolicy::Strict),
        false
    );
    assert_eq!(
        needs_user_approval(CommandRiskLevel::Mutation, ApprovalPolicy::Strict),
        true
    );
    assert_eq!(
        needs_user_approval(CommandRiskLevel::Critical, ApprovalPolicy::Strict),
        true
    );

    // Smart: only critical requires approval
    assert_eq!(
        needs_user_approval(CommandRiskLevel::Safe, ApprovalPolicy::Smart),
        false
    );
    assert_eq!(
        needs_user_approval(CommandRiskLevel::Mutation, ApprovalPolicy::Smart),
        false
    );
    assert_eq!(
        needs_user_approval(CommandRiskLevel::Critical, ApprovalPolicy::Smart),
        true
    );

    // Auto: all pass
    assert_eq!(
        needs_user_approval(CommandRiskLevel::Safe, ApprovalPolicy::Auto),
        false
    );
    assert_eq!(
        needs_user_approval(CommandRiskLevel::Mutation, ApprovalPolicy::Auto),
        false
    );
    assert_eq!(
        needs_user_approval(CommandRiskLevel::Critical, ApprovalPolicy::Auto),
        false
    );
}

#[test]
fn test_redaction() {
    let input = "Server responded with password=SuperSecret123&token=abcde456; and done";
    let redacted = redact_sensitive_output(input);
    assert!(!redacted.contains("SuperSecret123"));
    assert!(!redacted.contains("abcde456"));
    assert!(redacted.contains("***"));
}
struct IsolatedState(std::path::PathBuf);
impl IsolatedState {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("gateway-e2e-{}", uuid::Uuid::new_v4()));
        crate::gateway_audit::private_dir(&p).unwrap();
        TEST_STATE_DIR.with(|v| *v.borrow_mut() = Some(p.clone()));
        Self(p)
    }
    fn gateway(&self) -> AgentGateway {
        AgentGateway {
            port: 0,
            state_directory: self.0.clone(),
            ssh_port: Arc::new(AtomicU16::new(0)),
            ssh_running: Arc::new(AtomicBool::new(false)),
            token: "unit-test-only".into(),
            policy: Arc::new(Mutex::new(ApprovalPolicy::Auto)),
            is_running: Arc::new(AtomicBool::new(true)),
            pending_approvals: Default::default(),
            approval_requests: Default::default(),
            audit_logs: Default::default(),
            pty_mgr: PtyManager::new(),
            connections: AgentConnections::new(),
            control_connections: AgentConnections::new(),
            transfer_connections: AgentConnections::new(),
            app_handle: None,
            active_requests: Default::default(),
            work_requests: Default::default(),
            audit_error: Default::default(),
            audit_pending: Default::default(),
            audit_lost: Default::default(),
            listeners: Default::default(),
            client_public: Vec::new(),
            ssh_ports: (0, 0),
        }
    }
}
impl Drop for IsolatedState {
    fn drop(&mut self) {
        TEST_STATE_DIR.with(|v| *v.borrow_mut() = None);
        TEST_REMOTE.with(|v| *v.borrow_mut() = None);
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
#[test]
fn upload_dispatch_resume_deduplicate_verify_and_commit() {
    use base64::Engine;
    use serde_json::json;
    use sha2::{Digest, Sha256};
    let state = IsolatedState::new();
    let gw = state.gateway();
    let id = uuid::Uuid::new_v4().to_string();
    let dest = state.0.join("target.bin");
    let bytes = b"binary\0\xffmkfspayload";
    let hash = format!("{:x}", Sha256::digest(bytes));
    let request =
        json!({"server":"local","request_id":id,"path":dest,"size":bytes.len(),"sha256":hash});
    let create = gw
        .dispatch_http(&Method::Post, "/api/uploads", "/api/uploads", &request)
        .unwrap();
    assert_eq!(create["upload"]["offset"], 0);
    let endpoint = format!("/api/uploads/{id}/chunk");
    let data = base64::engine::general_purpose::STANDARD.encode(bytes);
    assert!(
        gw.dispatch_http(
            &Method::Post,
            &endpoint,
            &endpoint,
            &json!({"offset":1,"data":data})
        )
        .is_err()
    );
    for _ in 0..2 {
        gw.dispatch_http(
            &Method::Post,
            &endpoint,
            &endpoint,
            &json!({"offset":0,"data":data}),
        )
        .unwrap();
    }
    assert!(gw.dispatch_http(&Method::Post,&endpoint,&endpoint,&json!({"offset":0,"data":base64::engine::general_purpose::STANDARD.encode(vec![0;bytes.len()])})).is_err());
    let restarted = state.gateway();
    assert_eq!(
        restarted
            .dispatch_http(&Method::Post, "/api/uploads", "/api/uploads", &request)
            .unwrap()["upload"]["offset"],
        bytes.len()
    );
    let commit = format!("/api/uploads/{id}/commit");
    for _ in 0..2 {
        restarted
            .dispatch_http(&Method::Post, &commit, &commit, &json!({}))
            .unwrap();
    }
    assert_eq!(std::fs::read(&dest).unwrap(), bytes);
    let mut changed = request.clone();
    changed["path"] = json!(state.0.join("elsewhere"));
    assert!(
        gw.dispatch_http(&Method::Post, "/api/uploads", "/api/uploads", &changed)
            .is_err()
    );
    let second = uuid::Uuid::new_v4().to_string();
    changed = request.clone();
    changed["request_id"] = json!(second);
    gw.dispatch_http(&Method::Post, "/api/uploads", "/api/uploads", &changed)
        .unwrap();
    let endpoint = format!("/api/uploads/{second}/chunk");
    gw.dispatch_http(
        &Method::Post,
        &endpoint,
        &endpoint,
        &json!({"offset":0,"data":data}),
    )
    .unwrap();
    let commit = format!("/api/uploads/{second}/commit");
    assert!(
        gw.dispatch_http(&Method::Post, &commit, &commit, &json!({}))
            .is_err()
    );
    assert_eq!(std::fs::read(dest).unwrap(), bytes);
}
#[test]
fn upload_hash_failure_and_abort_do_not_touch_target() {
    use base64::Engine;
    use serde_json::json;
    let state = IsolatedState::new();
    let gw = state.gateway();
    let id = uuid::Uuid::new_v4().to_string();
    let dest = state.0.join("target");
    gw.dispatch_http(
        &Method::Post,
        "/api/uploads",
        "/api/uploads",
        &json!({"server":"local","request_id":id,"path":dest,"size":3,"sha256":"0".repeat(64)}),
    )
    .unwrap();
    let p = format!("/api/uploads/{id}/chunk");
    gw.dispatch_http(
        &Method::Post,
        &p,
        &p,
        &json!({"offset":0,"data":base64::engine::general_purpose::STANDARD.encode(b"abc")}),
    )
    .unwrap();
    let p = format!("/api/uploads/{id}/commit");
    assert!(gw.dispatch_http(&Method::Post, &p, &p, &json!({})).is_err());
    assert!(!dest.exists());
    let p = format!("/api/uploads/{id}/abort");
    gw.dispatch_http(&Method::Post, &p, &p, &json!({})).unwrap();
    assert!(
        !crate::gateway_transfer::state_dir()
            .unwrap()
            .join(format!("{id}.part"))
            .exists()
    );
}
#[test]
fn durable_job_dispatch_does_not_relaunch_after_reconnect() {
    use serde_json::json;
    let state = IsolatedState::new();
    let gw = state.gateway();
    let id = uuid::Uuid::new_v4().to_string();
    let marker = state.0.join("count");
    let command = format!(
        "printf x >> {}; printf output; printf error >&2; exit 7",
        crate::gateway_jobs::quote(marker.to_str().unwrap())
    );
    let request = json!({"server":"local","request_id":id,"command":command});
    gw.dispatch_http(&Method::Post, "/api/jobs", "/api/jobs", &request)
        .unwrap();
    let restarted = state.gateway();
    restarted
        .dispatch_http(&Method::Post, "/api/jobs", "/api/jobs", &request)
        .unwrap();
    let p = format!("/api/jobs/{id}");
    let mut result = json!({});
    for _ in 0..100 {
        result = restarted
            .dispatch_http(&Method::Get, &p, &p, &json!({}))
            .unwrap();
        if result["job"]["exit_code"].is_i64() {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(result["job"]["exit_code"], 7);
    assert_eq!(result["stdout"], "output");
    assert_eq!(result["stderr"], "error");
    assert_eq!(std::fs::read(marker).unwrap(), b"x");
    let paged = restarted
        .dispatch_http(
            &Method::Get,
            &p,
            &format!("{p}?offset=3&stderr_offset=2"),
            &json!({}),
        )
        .unwrap();
    assert_eq!(paged["stdout"], "put");
    assert_eq!(paged["stderr"], "ror");
    restarted
        .dispatch_http(&Method::Delete, &p, &p, &json!({}))
        .unwrap();
}
#[test]
fn audit_persists_redacts_rotates_and_records_policy() {
    let state = IsolatedState::new();
    let gw = state.gateway();
    gw.set_policy_from_desktop(ApprovalPolicy::Strict);
    gw.audit_event(
        "Codex",
        "local",
        "python3 -c SECRET_PAYLOAD",
        CommandRiskLevel::Critical,
        "auto",
        "unknown",
        None,
        "password=secret-value token=private-value",
        1,
    );
    let path = state.0.join("audit.jsonl");
    let raw = std::fs::read_to_string(&path).unwrap();
    for secret in ["SECRET_PAYLOAD", "secret-value", "private-value"] {
        assert!(!raw.contains(secret));
    }
    let loaded = crate::gateway_audit::load(&path);
    assert_eq!(loaded.len(), 2);
    assert_eq!(loaded[0].status, "unknown");
    assert!(!loaded[0].approved_by_user);
    assert!(loaded[1].approved_by_user);
    std::fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .unwrap()
        .set_len(2 * 1024 * 1024)
        .unwrap();
    gw.audit_event(
        "Codex",
        "local",
        "hostname",
        CommandRiskLevel::Safe,
        "auto",
        "success",
        Some(0),
        "ok",
        1,
    );
    assert!(path.with_extension("jsonl.1").exists());
    gw.clear_audit().unwrap();
    assert_eq!(crate::gateway_audit::load(&path).len(), 1);
}
#[test]
fn unknown_scripts_are_not_read_only_and_secrets_are_filtered() {
    for command in [
        "python3 -c 'open(\"/tmp/x\",\"w\")'",
        "node -e 'process.exit(0)'",
        "echo hi; touch /tmp/a",
        "find / -exec sh {} \\;",
        "cat $(touch /tmp/a)",
        "custom-command cp /tmp/x /tmp/y",
        "npm run script cp /tmp/x /tmp/y",
        "/usr/bin/../../tmp/cat file",
        "/tmp/cat /tmp/a",
        "hostname new-hostname",
        "date -s 2026-01-01",
        "ss -K dst 127.0.0.1",
    ] {
        assert_eq!(classify_command(command), CommandRiskLevel::Critical);
    }
    let raw = r#"{"password":"SecretA", "api_token":"SecretB"} Authorization: Bearer SecretC --password SecretD 令牌token=SecretE"#;
    let redacted = redact_sensitive_output(raw);
    for secret in ["SecretA", "SecretB", "SecretC", "SecretD", "SecretE"] {
        assert!(!redacted.contains(secret), "{redacted}");
    }
}

#[test]
fn http_agents_cannot_change_policy_or_authenticate_with_query_token() {
    let state = IsolatedState::new();
    let gw = state.gateway();
    let request: tiny_http::Request = tiny_http::TestRequest::new()
        .with_method(Method::Post)
        .with_path("/api/policy")
        .with_body(r#"{"policy":"auto"}"#)
        .with_header(Header::from_bytes("Authorization", "Bearer unit-test-only").unwrap())
        .into();
    *gw.policy.lock().unwrap() = ApprovalPolicy::Strict;
    gw.handle_http_request(request);
    assert_eq!(*gw.policy.lock().unwrap(), ApprovalPolicy::Strict);
    assert_eq!(gw.audit_logs.lock().unwrap()[0].status, "denied");
    let request: tiny_http::Request = tiny_http::TestRequest::new()
        .with_path("/api/servers?token=unit-test-only")
        .into();
    assert!(!gw.check_auth(&request));
    gw.handle_http_request(request);
    assert_eq!(
        gw.audit_logs.lock().unwrap()[0].agent_name,
        "authentication"
    );
}
#[test]
fn rejected_approval_does_not_execute_or_replay() {
    let state = IsolatedState::new();
    let gw = state.gateway();
    *gw.policy.lock().unwrap() = ApprovalPolicy::Strict;
    let pending = gw.pending_approvals.clone();
    let approver = std::thread::spawn(move || {
        for _ in 0..100 {
            let sender = {
                let mut map = pending.lock().unwrap();
                let key = map.keys().next().cloned();
                key.and_then(|k| map.remove(&k))
            };
            if let Some(sender) = sender {
                sender.send(false).unwrap();
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("approval request missing")
    });
    let marker = state.0.join("must-not-exist");
    let command = format!(
        "touch {}",
        crate::gateway_jobs::quote(marker.to_str().unwrap())
    );
    assert!(
        gw.execute_audited("local", &command, "test")
            .unwrap_err()
            .starts_with("denied:")
    );
    approver.join().unwrap();
    assert!(!marker.exists());
    let log = gw.audit_logs.lock().unwrap();
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].approval_source, "denied");
    assert_eq!(log[0].execution_phase, "not_sent");
}
#[derive(Clone)]
struct FixtureServer;
struct FixtureHandler {
    channels: HashMap<ChannelId, Channel<Msg>>,
}
impl RusshServer for FixtureServer {
    type Handler = FixtureHandler;
    fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> Self::Handler {
        FixtureHandler {
            channels: HashMap::new(),
        }
    }
}
impl RusshHandler for FixtureHandler {
    type Error = russh::Error;
    async fn auth_password(&mut self, _: &str, _: &str) -> Result<RusshAuth, Self::Error> {
        Ok(RusshAuth::Accept)
    }
    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _: &mut RusshSession,
    ) -> Result<(), Self::Error> {
        self.channels.insert(channel.id(), channel);
        reply.accept().await;
        Ok(())
    }
    async fn exec_request(
        &mut self,
        id: ChannelId,
        data: &[u8],
        session: &mut RusshSession,
    ) -> Result<(), Self::Error> {
        session.channel_success(id)?;
        let channel = self.channels.remove(&id).unwrap();
        let command = String::from_utf8(data.to_vec()).unwrap();
        tokio::spawn(async move {
            if command != "fixture stream" {
                let output = tokio::process::Command::new("sh")
                    .arg("-c")
                    .arg(command)
                    .kill_on_drop(true)
                    .output()
                    .await
                    .unwrap();
                let _ = channel.data(output.stdout.as_slice()).await;
                let _ = channel.extended_data(1, output.stderr.as_slice()).await;
                let _ = channel
                    .exit_status(output.status.code().unwrap_or(255) as u32)
                    .await;
                let _ = channel.eof().await;
                let _ = channel.close().await;
                return;
            }
            // More than an SSH receive window on stderr BEFORE stdout: sequential readers deadlock here.
            let _ = channel
                .extended_data(1, &vec![b'e'; 3 * 1024 * 1024][..])
                .await;
            let _ = channel.data(&b"complete"[..]).await;
            let _ = channel.extended_data(1, &b"\xff"[..]).await;
            let _ = channel.exit_status(7).await;
            let _ = channel.eof().await;
            let _ = channel.close().await;
        });
        Ok(())
    }
    async fn subsystem_request(
        &mut self,
        id: ChannelId,
        name: &str,
        session: &mut RusshSession,
    ) -> Result<(), Self::Error> {
        if name != "sftp" {
            session.channel_failure(id)?;
            return Ok(());
        }
        session.channel_success(id)?;
        let channel = self.channels.remove(&id).unwrap();
        tokio::spawn(async move {
            let mut child = tokio::process::Command::new("/usr/libexec/sftp-server")
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .kill_on_drop(true)
                .spawn()
                .unwrap();
            let (mut reader, mut writer) = tokio::io::split(channel.into_stream());
            let mut input = child.stdin.take().unwrap();
            let mut output = child.stdout.take().unwrap();
            let send = async {
                let _ = tokio::io::copy(&mut reader, &mut input).await;
                drop(input);
            };
            let recv = async {
                let _ = tokio::io::copy(&mut output, &mut writer).await;
                let _ = tokio::io::AsyncWriteExt::shutdown(&mut writer).await;
            };
            tokio::join!(send, recv);
            let _ = child.wait().await;
        });
        Ok(())
    }
}
struct SshFixture {
    rt: Option<tokio::runtime::Runtime>,
    task: tokio::task::JoinHandle<()>,
    port: u16,
    key: Vec<u8>,
}
impl SshFixture {
    fn new() -> Self {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let key =
            russh::keys::PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519)
                .unwrap();
        let public = key.public_key().to_bytes().unwrap();
        let listener = rt
            .block_on(tokio::net::TcpListener::bind("127.0.0.1:0"))
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        let task = rt.spawn(async move {
            let config = Arc::new(russh::server::Config {
                keys: vec![key],
                auth_rejection_time: Duration::ZERO,
                ..Default::default()
            });
            let _ = FixtureServer.run_on_socket(config, &listener).await;
        });
        Self {
            rt: Some(rt),
            task,
            port,
            key: public,
        }
    }
    fn session(&self) -> ssh2::Session {
        let tcp = std::net::TcpStream::connect(("127.0.0.1", self.port)).unwrap();
        let mut session = ssh2::Session::new().unwrap();
        session.set_tcp_stream(tcp);
        session.set_timeout(5000);
        session.handshake().unwrap();
        assert_eq!(session.host_key().unwrap().0, self.key);
        session
            .userauth_password("fixture", "fixture-only")
            .unwrap();
        session
    }
    fn install(&self, gw: &AgentGateway) {
        let options = SpawnOptions {
            session_id: "fixture".into(),
            is_local: false,
            host_id: None,
            host_name: Some("fixture".into()),
            host: Some("127.0.0.1".into()),
            port: Some(self.port),
            username: Some("fixture".into()),
            identity_file: None,
            proxy_type: None,
            jump_host_id: None,
            proxy_url: None,
            cols: None,
            rows: None,
        };
        for pool in [
            &gw.connections,
            &gw.control_connections,
            &gw.transfer_connections,
        ] {
            let lease = pool.acquire(&options).unwrap();
            *lease.lock().unwrap() = Some(self.session());
        }
        TEST_REMOTE.with(|p| *p.borrow_mut() = Some(options));
    }
}
impl Drop for SshFixture {
    fn drop(&mut self) {
        self.task.abort();
        if let Some(rt) = self.rt.take() {
            rt.shutdown_timeout(Duration::from_secs(2));
        }
    }
}
#[test]
fn ssh_collector_drains_stderr_window_before_stdout_without_decode_failure() {
    let fixture = SshFixture::new();
    let session = fixture.session();
    let mut channel = session.channel_session().unwrap();
    channel.exec("fixture stream").unwrap();
    channel.send_eof().unwrap();
    let (code, out, err) = crate::gateway_io::collect(&mut channel, &session).unwrap();
    assert_eq!(code, 7);
    assert!(out.contains("输出达到 1 MiB"));
    assert_eq!(err.len(), 512 * 1024);
    assert!(out.starts_with("complete"));
    assert!(session.is_blocking());
}
#[test]
fn real_sftp_upload_verifies_and_finalizes_without_shell_payload() {
    use base64::Engine;
    use serde_json::json;
    use sha2::{Digest, Sha256};
    assert!(
        std::path::Path::new("/usr/libexec/sftp-server").exists(),
        "SFTP integration fixture requires local sftp-server"
    );
    let state = IsolatedState::new();
    let fixture = SshFixture::new();
    let gw = state.gateway();
    fixture.install(&gw);
    let id = uuid::Uuid::new_v4().to_string();
    let dest = state.0.join("remote.bin");
    let bytes: Vec<u8> = (0..180000).map(|i| (i % 251) as u8).collect();
    let hash = format!("{:x}", Sha256::digest(&bytes));
    gw.dispatch_http(
        &Method::Post,
        "/api/uploads",
        "/api/uploads",
        &json!({"server":"fixture","request_id":id,"path":dest,"size":bytes.len(),"sha256":hash}),
    )
    .unwrap();
    let path = format!("/api/uploads/{id}/chunk");
    for (offset, part) in bytes.chunks(65536).enumerate() {
        gw.dispatch_http(&Method::Post,&path,&path,&json!({"offset":offset*65536,"data":base64::engine::general_purpose::STANDARD.encode(part)})).unwrap();
    }
    let path = format!("/api/uploads/{id}/commit");
    gw.dispatch_http(&Method::Post, &path, &path, &json!({}))
        .unwrap();
    assert_eq!(std::fs::read(dest).unwrap(), bytes);
    gw.dispatch_http(&Method::Post, &path, &path, &json!({}))
        .unwrap();
    gw.connections.clear();
}
#[test]
fn cleanup_keeps_idempotency_tombstones_and_corruption_never_relaunches() {
    use serde_json::json;
    let state = IsolatedState::new();
    let gw = state.gateway();
    let id = uuid::Uuid::new_v4().to_string();
    let marker = state.0.join("runs");
    let request = json!({"server":"local","request_id":id,"command":format!("printf x >> {}",crate::gateway_jobs::quote(marker.to_str().unwrap()))});
    gw.dispatch_http(&Method::Post, "/api/jobs", "/api/jobs", &request)
        .unwrap();
    let path = format!("/api/jobs/{id}");
    for _ in 0..100 {
        let result = gw
            .dispatch_http(&Method::Get, &path, &path, &json!({}))
            .unwrap();
        if result["job"]["exit_code"] == 0 {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    gw.dispatch_http(&Method::Delete, &path, &path, &json!({}))
        .unwrap();
    let reused = gw
        .dispatch_http(&Method::Post, "/api/jobs", "/api/jobs", &request)
        .unwrap();
    assert_eq!(reused["job"]["status"], "cleaned");
    assert_eq!(std::fs::read(&marker).unwrap(), b"x");
    let record = state.0.join("jobs").join(format!("{id}.json"));
    std::fs::write(&record, b"broken record").unwrap();
    assert!(
        gw.dispatch_http(&Method::Post, "/api/jobs", "/api/jobs", &request)
            .is_err()
    );
    assert_eq!(std::fs::read(marker).unwrap(), b"x");
    assert_eq!(std::fs::read(record).unwrap(), b"broken record");
}
#[test]
fn upload_records_are_fail_closed_and_another_resource_is_not_blocked() {
    use serde_json::json;
    let state = IsolatedState::new();
    let gw = state.gateway();
    let id = uuid::Uuid::new_v4().to_string();
    let other = uuid::Uuid::new_v4().to_string();
    for id in [&id, &other] {
        gw.dispatch_http(&Method::Post,"/api/uploads","/api/uploads",&json!({"server":"local","request_id":id,"path":state.0.join(id),"size":0,"sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"})).unwrap();
    }
    let _busy = crate::gateway_state::lock("uploads", &id).unwrap();
    let path = format!("/api/uploads/{id}");
    assert_eq!(
        gw.dispatch_http(&Method::Get, &path, &path, &json!({}))
            .unwrap()["upload"]["status"],
        "receiving"
    );
    let path = format!("/api/uploads/{other}/commit");
    gw.dispatch_http(&Method::Post, &path, &path, &json!({}))
        .unwrap();
    let record = state.0.join("uploads").join(format!("{other}.json"));
    std::fs::write(&record, b"invalid").unwrap();
    assert!(gw.dispatch_http(&Method::Post,"/api/uploads","/api/uploads",&json!({"server":"local","request_id":other,"path":state.0.join(&other),"size":0,"sha256":"0".repeat(64)})).is_err());
    assert_eq!(std::fs::read(record).unwrap(), b"invalid");
}
#[test]
fn target_ids_outrank_aliases_and_ambiguous_accounts_are_rejected() {
    let state = IsolatedState::new();
    let gw = state.gateway();
    let mut a = gw.resolve_target_opts("local").unwrap();
    a.is_local = false;
    a.host_id = Some("server-a".into());
    a.host_name = Some("shared".into());
    a.host = Some("example".into());
    a.username = Some("alice".into());
    let mut b = a.clone();
    b.host_id = Some("server-b".into());
    b.host_name = Some("server-a".into());
    b.username = Some("bob".into());
    let selected = AgentGateway::select_target("server-a", &[a.clone()], &[b.clone()]).unwrap();
    assert_eq!(selected.username.as_deref(), Some("alice"));
    assert!(AgentGateway::select_target("example", &[a.clone(), b], &[]).is_err());
    assert!(AgentGateway::select_target("shared", &[a.clone()], &[a]).is_ok());
}
#[test]
fn gateway_stop_releases_both_listeners_and_native_auth_is_enforced() {
    use std::io::{Read, Write};
    let state = IsolatedState::new();
    let mut gw = state.gateway();
    let socket = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    gw.port = socket.local_addr().unwrap().port();
    drop(socket);
    let client =
        russh::keys::PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519).unwrap();
    gw.client_public = client.public_key().to_bytes().unwrap();
    for _ in 0..2 {
        gw.start_server().unwrap();
        let ssh_port = gw.ssh_port.load(Ordering::SeqCst);
        let connect = || {
            let mut session = ssh2::Session::new().unwrap();
            session.set_timeout(3000);
            session.set_tcp_stream(std::net::TcpStream::connect(("127.0.0.1", ssh_port)).unwrap());
            session.handshake().unwrap();
            session
        };
        let rejected = connect();
        assert!(rejected.auth_methods("local").is_ok());
        assert!(!rejected.authenticated());
        assert!(rejected.userauth_password("local", "wrong").is_err());
        drop(rejected);
        let untrusted = connect();
        let wrong_key =
            russh::keys::PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519)
                .unwrap();
        let wrong_private = wrong_key
            .to_openssh(russh::keys::ssh_key::LineEnding::LF)
            .unwrap();
        assert!(
            untrusted
                .userauth_pubkey_memory("local", None, &wrong_private, None)
                .is_err()
        );
        assert!(!untrusted.authenticated());
        drop(untrusted);
        let session = connect();
        let private = client
            .to_openssh(russh::keys::ssh_key::LineEnding::LF)
            .unwrap();
        session
            .userauth_pubkey_memory("local", None, &private, None)
            .unwrap();
        let mut channel = session.channel_session().unwrap();
        channel.exec("hostname").unwrap();
        let mut output = String::new();
        channel.read_to_string(&mut output).unwrap();
        channel.wait_close().unwrap();
        assert_eq!(channel.exit_status().unwrap(), 0);
        assert!(!output.trim().is_empty());
        drop(channel);
        drop(session);
        let mut http = std::net::TcpStream::connect(("127.0.0.1", gw.port)).unwrap();
        http.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        http.write_all(b"GET /api/status HTTP/1.0\r\n\r\n").unwrap();
        let mut body = String::new();
        http.read_to_string(&mut body).unwrap();
        assert!(body.contains("200 OK"));
        drop(http);
        gw.stop_server();
        assert_eq!(
            crate::gateway_audit::load(&state.0.join("audit.jsonl")).len(),
            gw.audit_logs.lock().unwrap().len(),
            "async test audit must stay in its own state directory"
        );
        assert!(!gw.is_running.load(Ordering::SeqCst));
        assert!(std::net::TcpStream::connect(("127.0.0.1", gw.port)).is_err());
        assert!(std::net::TcpStream::connect(("127.0.0.1", ssh_port)).is_err());
    }
}
#[test]
fn upstream_host_key_missing_matching_and_changed_are_distinguished() {
    let state = IsolatedState::new();
    let fixture = SshFixture::new();
    let session = fixture.session();
    let path = state.0.join("known_hosts");
    assert!(
        crate::sftp::verify_host_key_at(&session, "127.0.0.1", fixture.port, &path)
            .unwrap_err()
            .contains("未受信任")
    );
    let mut known = session.known_hosts().unwrap();
    known
        .add(
            &format!("[127.0.0.1]:{}", fixture.port),
            &fixture.key,
            "fixture",
            ssh2::KnownHostKeyFormat::Ed25519,
        )
        .unwrap();
    known
        .write_file(&path, ssh2::KnownHostFileKind::OpenSSH)
        .unwrap();
    assert!(crate::sftp::verify_host_key_at(&session, "127.0.0.1", fixture.port, &path).is_ok());
    let changed =
        russh::keys::PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519).unwrap();
    let mut wrong = session.known_hosts().unwrap();
    wrong
        .add(
            &format!("[127.0.0.1]:{}", fixture.port),
            &changed.public_key().to_bytes().unwrap(),
            "wrong",
            ssh2::KnownHostKeyFormat::Ed25519,
        )
        .unwrap();
    wrong
        .write_file(&path, ssh2::KnownHostFileKind::OpenSSH)
        .unwrap();
    assert!(
        crate::sftp::verify_host_key_at(&session, "127.0.0.1", fixture.port, &path)
            .unwrap_err()
            .contains("变化")
    );
}
#[test]
fn real_remote_upload_overwrite_preserves_permissions_and_job_survives_reconnect() {
    use base64::Engine;
    use serde_json::json;
    use sha2::{Digest, Sha256};
    use std::os::unix::fs::PermissionsExt;
    let state = IsolatedState::new();
    let fixture = SshFixture::new();
    let gw = state.gateway();
    fixture.install(&gw);
    let id = uuid::Uuid::new_v4().to_string();
    let target = state.0.join("remote-file");
    std::fs::write(&target, b"original").unwrap();
    std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o640)).unwrap();
    let bytes = b"replacement bytes";
    let request = json!({"server":"fixture","request_id":id,"path":target,"size":bytes.len(),"sha256":format!("{:x}",Sha256::digest(bytes)),"overwrite":true});
    gw.dispatch_http(&Method::Post, "/api/uploads", "/api/uploads", &request)
        .unwrap();
    let chunk = format!("/api/uploads/{id}/chunk");
    gw.dispatch_http(
        &Method::Post,
        &chunk,
        &chunk,
        &json!({"offset":0,"data":base64::engine::general_purpose::STANDARD.encode(bytes)}),
    )
    .unwrap();
    let commit = format!("/api/uploads/{id}/commit");
    gw.dispatch_http(&Method::Post, &commit, &commit, &json!({}))
        .unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), bytes);
    assert_eq!(
        std::fs::metadata(&target).unwrap().permissions().mode() & 0o777,
        0o640
    );
    let job_id = uuid::Uuid::new_v4().to_string();
    let marker = state.0.join("job-count");
    let datafile = state.0.join("large-file");
    let command = format!(
        "python3 - <<'CODE'\nfrom pathlib import Path\np=Path({:?});p.write_bytes(p.read_bytes()+b'x' if p.exists() else b'x')\nPath({:?}).write_bytes(b'z'*(20*1024*1024))\nprint('done')\nCODE",
        marker.to_str().unwrap(),
        datafile.to_str().unwrap()
    );
    let request = json!({"server":"fixture","request_id":job_id,"command":command});
    gw.dispatch_http(&Method::Post, "/api/jobs", "/api/jobs", &request)
        .unwrap();
    let restarted = state.gateway();
    fixture.install(&restarted);
    let path = format!("/api/jobs/{job_id}");
    let mut result = json!({});
    for _ in 0..100 {
        result = restarted
            .dispatch_http(&Method::Get, &path, &path, &json!({}))
            .unwrap();
        if result["job"]["exit_code"].is_i64() {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(result["job"]["exit_code"], 0, "{result}");
    assert_eq!(std::fs::read(&marker).unwrap(), b"x");
    assert_eq!(std::fs::metadata(datafile).unwrap().len(), 20 * 1024 * 1024);
    assert!(result["stdout"].as_str().unwrap().contains("done"));
    restarted
        .dispatch_http(&Method::Delete, &path, &path, &json!({}))
        .unwrap();
    assert_eq!(
        restarted
            .dispatch_http(&Method::Post, "/api/jobs", "/api/jobs", &request)
            .unwrap()["job"]["status"],
        "cleaned"
    );
    assert_eq!(std::fs::read(marker).unwrap(), b"x");
    gw.connections.clear();
    gw.control_connections.clear();
    gw.transfer_connections.clear();
    restarted.connections.clear();
    restarted.control_connections.clear();
    restarted.transfer_connections.clear();
}

#[test]
fn failed_audit_writes_are_retried_and_partial_utf8_lines_do_not_hide_history() {
    let state = IsolatedState::new();
    let gw = state.gateway();
    let path = state.0.join("audit.jsonl");
    std::fs::create_dir(&path).unwrap();
    gw.audit_event(
        "test",
        "local",
        "hostname",
        CommandRiskLevel::Safe,
        "auto",
        "success",
        Some(0),
        "first",
        0,
    );
    assert!(gw.audit_error.lock().unwrap().is_some());
    assert_eq!(gw.audit_pending.lock().unwrap().len(), 1);
    std::fs::remove_dir(&path).unwrap();
    gw.audit_event(
        "test",
        "local",
        "pwd",
        CommandRiskLevel::Safe,
        "auto",
        "success",
        Some(0),
        "second",
        0,
    );
    assert!(gw.audit_error.lock().unwrap().is_none());
    assert!(gw.audit_pending.lock().unwrap().is_empty());
    assert_eq!(crate::gateway_audit::load(&path).len(), 2);
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap();
    f.write_all(b"{broken utf8 \xff").unwrap();
    drop(f);
    gw.audit_event(
        "test",
        "local",
        "ls",
        CommandRiskLevel::Safe,
        "auto",
        "success",
        Some(0),
        "third",
        0,
    );
    assert_eq!(crate::gateway_audit::load(&path).len(), 3);
}
#[test]
fn legacy_record_identity_remains_readable_but_new_route_changes_are_rejected() {
    use sha2::Digest;
    let state = IsolatedState::new();
    let gw = state.gateway();
    let mut opts = gw.resolve_target_opts("local").unwrap();
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
            .unwrap()
        )
    );
    assert!(AgentGateway::identity_matches(&opts, &legacy).unwrap());
    let current = AgentGateway::options_identity(&opts).unwrap();
    assert!(current.starts_with("v2:"));
    opts.proxy_url = Some("http://fixture.invalid:8080".into());
    assert!(!AgentGateway::identity_matches(&opts, &current).unwrap());
    opts.username = Some("different".into());
    assert!(!AgentGateway::identity_matches(&opts, &legacy).unwrap());
}
#[test]
fn quoted_and_uri_secrets_are_redacted_before_audit_truncation() {
    let raw = r#"password="long secret with spaces" token='another secret' mongodb://name:credential@localhost/test"#;
    let clean = redact_sensitive_output(raw);
    for secret in ["long secret", "with spaces", "another secret", "credential"] {
        assert!(!clean.contains(secret), "{clean}");
    }
}

#[test]
fn setup_collision_cleanup_does_not_remove_an_existing_task_directory() {
    use serde_json::json;
    let state = IsolatedState::new();
    let gw = state.gateway();
    let id = uuid::Uuid::new_v4().to_string();
    let directory = state.0.join("jobs").join(format!("run-{id}"));
    std::fs::create_dir_all(&directory).unwrap();
    let foreign = directory.join("existing-data");
    std::fs::write(&foreign, b"preserve me").unwrap();
    let request = json!({"server":"local","request_id":id,"command":"true"});
    assert!(
        gw.dispatch_http(&Method::Post, "/api/jobs", "/api/jobs", &request)
            .is_err()
    );
    let path = format!("/api/jobs/{id}");
    gw.dispatch_http(&Method::Delete, &path, &path, &json!({}))
        .unwrap();
    assert_eq!(std::fs::read(foreign).unwrap(), b"preserve me");
    assert_eq!(crate::gateway_jobs::load(&id).unwrap().status, "cleaned");
}
