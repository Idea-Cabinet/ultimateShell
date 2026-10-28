use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::thread;

use crate::pty::SpawnOptions;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelEntry {
    pub id: String,
    pub session_id: String,
    pub tunnel_type: String, // "local", "remote", "dynamic"
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub status: String, // "active", "stopped", "error"
    pub description: String,
    pub error_msg: Option<String>,
}

pub struct ActiveTunnel {
    pub entry: TunnelEntry,
    pub child: Child,
}

#[derive(Clone, Default)]
pub struct TunnelManager {
    pub tunnels: Arc<Mutex<HashMap<String, ActiveTunnel>>>,
}

impl TunnelManager {
    pub fn new() -> Self {
        Self {
            tunnels: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn start_tunnel(
        &self,
        mut entry: TunnelEntry,
        opts: &SpawnOptions,
    ) -> Result<TunnelEntry, String> {
        let host = opts.host.as_deref().ok_or_else(|| "主机地址不能为空".to_string())?;
        let port = opts.port.unwrap_or(22);
        let user = opts.username.as_deref().unwrap_or("root");

        let mut cmd = Command::new("ssh");
        cmd.arg("-N"); // Do not execute remote command
        cmd.arg("-o").arg("StrictHostKeyChecking=accept-new");
        cmd.arg("-o").arg("ServerAliveInterval=15");
        cmd.arg("-o").arg("ServerAliveCountMax=3");
        cmd.arg("-o").arg("ExitOnForwardFailure=yes");
        cmd.arg("-p").arg(port.to_string());

        // Identity key
        if let Some(ref key_path) = opts.identity_file {
            let s = key_path.trim();
            if !s.is_empty() {
                let resolved_key = if s.starts_with("~/") {
                    if let Ok(home) = std::env::var("HOME") {
                        format!("{}/{}", home, &s[2..])
                    } else {
                        s.to_string()
                    }
                } else {
                    s.to_string()
                };
                cmd.arg("-i").arg(resolved_key);
            }
        }

        // Jump Host / Proxy
        if let Some(ref ptype) = opts.proxy_type {
            if ptype == "jump" {
                if let Some(ref jid) = opts.jump_host_id {
                    let all_hosts = crate::hosts::load_hosts();
                    if let Some(jh) = all_hosts.iter().find(|h| &h.id == jid) {
                        if let Some(ref jkey) = jh.identity_file {
                            let s = jkey.trim();
                            if !s.is_empty() {
                                let resolved_jkey = if s.starts_with("~/") {
                                    if let Ok(home) = std::env::var("HOME") {
                                        format!("{}/{}", home, &s[2..])
                                    } else {
                                        s.to_string()
                                    }
                                } else {
                                    s.to_string()
                                };
                                cmd.arg("-o").arg(format!(
                                    "ProxyCommand=ssh -i {} -p {} -W %h:%p {}@{}",
                                    resolved_jkey, jh.port, jh.username, jh.host
                                ));
                            } else {
                                cmd.arg("-J").arg(format!("{}@{}:{}", jh.username, jh.host, jh.port));
                            }
                        } else {
                            cmd.arg("-J").arg(format!("{}@{}:{}", jh.username, jh.host, jh.port));
                        }
                    }
                }
            } else if ptype == "proxy" {
                if let Some(ref purl) = opts.proxy_url {
                    let p = purl.trim();
                    if !p.is_empty() {
                        let (is_http, raw_addr) = if p.starts_with("http://") {
                            (true, p.trim_start_matches("http://"))
                        } else if p.starts_with("socks5://") {
                            (false, p.trim_start_matches("socks5://"))
                        } else if p.starts_with("socks5h://") {
                            (false, p.trim_start_matches("socks5h://"))
                        } else {
                            (false, p)
                        };
                        let proto = if is_http { "connect" } else { "5" };
                        cmd.arg("-o").arg(format!("ProxyCommand=nc -X {} -x {} %h %p", proto, raw_addr));
                    }
                }
            }
        }

        // Forwarding arguments
        match entry.tunnel_type.as_str() {
            "local" => {
                let target_host = if entry.remote_host.trim().is_empty() {
                    "127.0.0.1"
                } else {
                    entry.remote_host.trim()
                };
                cmd.arg("-L").arg(format!(
                    "127.0.0.1:{}:{}:{}",
                    entry.local_port, target_host, entry.remote_port
                ));
            }
            "remote" => {
                let local_target = if entry.remote_host.trim().is_empty() {
                    "127.0.0.1"
                } else {
                    entry.remote_host.trim()
                };
                cmd.arg("-R").arg(format!(
                    "{}:{}:{}",
                    entry.remote_port, local_target, entry.local_port
                ));
            }
            "dynamic" => {
                // SOCKS5 Dynamic Forwarding
                cmd.arg("-D").arg(format!("127.0.0.1:{}", entry.local_port));
            }
            other => return Err(format!("不支持的隧道类型: {}", other)),
        }

        cmd.arg(format!("{}@{}", user, host));
        cmd.stdout(Stdio::null());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("启动隧道失败: {}", e))?;

        // Give ssh 300ms to bind the port and check if it failed immediately
        thread::sleep(Duration::from_millis(300));
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut err_str = String::new();
                if let Some(mut stderr) = child.stderr.take() {
                    use std::io::Read;
                    stderr.read_to_string(&mut err_str).ok();
                }
                return Err(format!(
                    "隧道进程异常退出 (退出码 {}): {}",
                    status,
                    if err_str.trim().is_empty() { "端口可能已被占用或认证失败" } else { err_str.trim() }
                ));
            }
            Ok(None) => {
                // Running normally
            }
            Err(e) => return Err(format!("检测隧道状态错误: {}", e)),
        }

        entry.status = "active".to_string();
        entry.error_msg = None;

        let mut map = self.tunnels.lock().unwrap();
        // If existing tunnel with same id, stop it first
        if let Some(mut old) = map.remove(&entry.id) {
            old.child.kill().ok();
            old.child.wait().ok();
        }

        map.insert(
            entry.id.clone(),
            ActiveTunnel {
                entry: entry.clone(),
                child,
            },
        );

        Ok(entry)
    }

    pub fn stop_tunnel(&self, tunnel_id: &str) -> Result<(), String> {
        let mut map = self.tunnels.lock().unwrap();
        if let Some(mut active) = map.remove(tunnel_id) {
            active.child.kill().ok();
            active.child.wait().ok();
            Ok(())
        } else {
            Err("未找到运行中的隧道".to_string())
        }
    }

    pub fn list_tunnels(&self, session_id: Option<&str>) -> Vec<TunnelEntry> {
        let mut map = self.tunnels.lock().unwrap();
        let mut list = Vec::new();

        for (_id, active) in map.iter_mut() {
            // Check if process is still alive
            match active.child.try_wait() {
                Ok(Some(status)) => {
                    active.entry.status = "error".to_string();
                    active.entry.error_msg = Some(format!("进程已退出 ({})", status));
                }
                Ok(None) => {
                    active.entry.status = "active".to_string();
                }
                Err(e) => {
                    active.entry.status = "error".to_string();
                    active.entry.error_msg = Some(e.to_string());
                }
            }

            if let Some(sid) = session_id {
                if active.entry.session_id == sid {
                    list.push(active.entry.clone());
                }
            } else {
                list.push(active.entry.clone());
            }
        }

        list
    }

    pub fn cleanup_session(&self, session_id: &str) {
        let mut map = self.tunnels.lock().unwrap();
        let ids_to_remove: Vec<String> = map
            .iter()
            .filter(|(_, t)| t.entry.session_id == session_id)
            .map(|(id, _)| id.clone())
            .collect();

        for id in ids_to_remove {
            if let Some(mut t) = map.remove(&id) {
                t.child.kill().ok();
                t.child.wait().ok();
            }
        }
    }
}
