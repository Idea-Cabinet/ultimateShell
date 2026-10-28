use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

use crate::ssh_auth::PasswordTracker;

#[derive(Clone, Serialize)]
pub struct PasswordUpdatePayload {
    pub host_id: String,
    pub host_name: String,
    pub username: Option<String>,
    pub new_password: String,
}

pub struct PtySession {
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub master: Box<dyn MasterPty + Send>,
    pub child: Box<dyn Child + Send>,
    pub is_local: bool,
    pub pid: Option<u32>,
    pub opts: SpawnOptions,
    pub password_tracker: Option<Arc<Mutex<PasswordTracker>>>,
    pub active_user: Arc<Mutex<String>>,
}

fn extract_prompt_username(chunk: &str) -> Option<String> {
    if let Some(at_idx) = chunk.rfind('@') {
        let prefix = &chunk[..at_idx];
        let user_start = prefix.rfind(|c: char| !c.is_alphanumeric() && c != '_' && c != '-');
        let user = match user_start {
            Some(idx) => &prefix[idx + 1..],
            None => prefix,
        };
        if !user.is_empty() && user.len() <= 32 && user.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
            let after = &chunk[at_idx + 1..];
            if after.contains(':') || after.contains('#') || after.contains('$') || after.contains('~') || after.contains(']') || after.contains(' ') {
                return Some(user.to_string());
            }
        }
    }
    None
}

#[derive(Clone, Default)]
pub struct PtyManager {
    pub sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SpawnOptions {
    pub session_id: String,
    pub is_local: bool,
    pub host_id: Option<String>,
    pub host_name: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub identity_file: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn spawn(&self, app: AppHandle, opts: SpawnOptions) -> Result<(), String> {
        let pty_system = native_pty_system();
        let size = PtySize {
            rows: opts.rows.unwrap_or(24),
            cols: opts.cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system.openpty(size).map_err(|e| e.to_string())?;

        let auth_token = uuid::Uuid::new_v4().to_string();
        let success_marker = format!("\x1b]777;ultimateshell-auth-{}\x07", auth_token);
        let mut cmd = if opts.is_local {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| {
                if cfg!(target_os = "windows") {
                    "powershell.exe".to_string()
                } else {
                    "/bin/zsh".to_string()
                }
            });
            let mut c = CommandBuilder::new(shell);
            if let Ok(home) = std::env::var("HOME") {
                c.cwd(home);
            }
            c
        } else {
            let host = opts.host.as_deref().ok_or_else(|| "Host is required for SSH".to_string())?;
            let port = opts.port.unwrap_or(22);
            let user = opts.username.as_deref().unwrap_or("root");

            let mut c = CommandBuilder::new("ssh");
            c.arg("-o");
            c.arg("StrictHostKeyChecking=accept-new");
            c.arg("-o");
            c.arg("ServerAliveInterval=15");
            c.arg("-o");
            c.arg("ServerAliveCountMax=3");
            c.arg("-o");
            c.arg("TCPKeepAlive=yes");
            c.arg("-o");
            c.arg("ConnectTimeout=10");
            c.arg("-o");
            c.arg("PermitLocalCommand=yes");
            c.arg("-o");
            c.arg(format!("LocalCommand=printf '\\033]777;ultimateshell-auth-{}\\007'", auth_token));
            c.arg("-p");
            c.arg(port.to_string());

            if let Some(ref key_path) = opts.identity_file {
                if !key_path.trim().is_empty() {
                    c.arg("-i");
                    c.arg(key_path);
                }
            }

            c.arg(format!("{}@{}", user, host));
            c
        };

        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "UltimateShell");
        cmd.env("SHELL_SESSIONS_DISABLE", "1");
        cmd.env_remove("TERM_SESSION_ID");

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        let pid = child.process_id();
        drop(pair.slave);

        let writer = Arc::new(Mutex::new(pair.master.take_writer().map_err(|e| e.to_string())?));
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

        let session_id = opts.session_id.clone();
        let app_clone = app.clone();
        let sid_clone = session_id.clone();

        // Check if there is an encrypted password saved in the hardware vault
        let saved_password = opts
            .host_id
            .as_deref()
            .and_then(|hid| crate::vault::get_password(hid));

        let tracker = if !opts.is_local && opts.host_id.is_some() {
            Some(Arc::new(Mutex::new(PasswordTracker::new(
                saved_password, opts.host_id.clone(), opts.host_name.clone(),
            ))))
        } else {
            None
        };
        if let Some(ref tracker) = tracker {
            tracker.lock().unwrap().set_success_marker(success_marker);
        }
        let tracker_clone = tracker.clone();

        let initial_user = opts.username.clone().unwrap_or_else(|| {
            if opts.is_local {
                std::env::var("USER").unwrap_or_else(|_| "local".to_string())
            } else {
                "root".to_string()
            }
        });
        let active_user = Arc::new(Mutex::new(initial_user));
        let active_user_clone = Arc::clone(&active_user);

        let writer_clone = Arc::clone(&writer);

        // Channel decouples raw PTY reads from IPC batching
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();

        // Thread 1: Fast Raw PTY Reader with OS Pipe Backpressure
        thread::spawn(move || {
            let mut buf = [0u8; 16384]; // 16KB read buffer
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                if tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        });

        // Thread 2: Adaptive Frame Micro-Batcher (Aggregates high-frequency bursts, zero-latency on human typing)
        thread::spawn(move || {
            let max_batch_bytes = 48 * 1024; // 48KB max IPC chunk
            let max_batch_duration = std::time::Duration::from_millis(10); // ~100fps max

            while let Ok(first_chunk) = rx.recv() {
                let mut raw_batch = first_chunk;
                let start_time = std::time::Instant::now();

                // If more data is actively available, accumulate up to max_batch_bytes or 10ms
                while raw_batch.len() < max_batch_bytes && start_time.elapsed() < max_batch_duration {
                    match rx.try_recv() {
                        Ok(more) => raw_batch.extend(more),
                        Err(std::sync::mpsc::TryRecvError::Empty) => break, // Nothing waiting, send immediately!
                        Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
                    }
                }

                let mut chunk = String::from_utf8_lossy(&raw_batch).to_string();
                let mut is_login_success = false;

                if let Some(user) = extract_prompt_username(&chunk) {
                    let mut emit_user = false;
                    if let Ok(mut lock) = active_user_clone.lock() {
                        if *lock != user {
                            *lock = user.clone();
                            emit_user = true;
                        }
                    }
                    if emit_user {
                        let user_event = format!("pty-user-{}", sid_clone);
                        let _ = app_clone.emit(&user_event, user.clone());

                        // Detect if password was used/updated during su user switch
                        if let Some(ref t) = tracker_clone {
                            if let Ok(mut lock) = t.lock() {
                                if let Some(tent) = lock.tentative_password.take() {
                                    if !tent.trim().is_empty() {
                                        let target = lock.target_switch_user.take().unwrap_or_else(|| user.clone());
                                        let payload = PasswordUpdatePayload {
                                            host_id: lock.host_id.clone().unwrap_or_default(),
                                            host_name: lock.host_name.clone().unwrap_or_else(|| "服务器".to_string()),
                                            username: Some(target),
                                            new_password: tent,
                                        };
                                        let _ = app_clone.emit("ssh-password-update-prompt", payload);
                                    }
                                }
                                lock.is_tracking = false;
                                lock.target_switch_user = None;
                                lock.auto_switch_password = None;
                            }
                        }
                    }
                }

                if let Some(ref tracker) = tracker_clone {
                    if let Ok(mut tracker) = tracker.lock() {
                        chunk = tracker.filter_output(&chunk);
                        is_login_success = tracker.login_succeeded();
                        if let Some(password) = tracker.observe_output(&chunk) {
                            // SSH disables echo before emitting its password prompt.
                            // Send once, without a delayed task racing manual input.
                            if let Ok(mut writer) = writer_clone.lock() {
                                let _ = writer.write_all(format!("{}\r", password).as_bytes());
                                let _ = writer.flush();
                            }
                        }
                    }
                }

                if is_login_success {
                    if let Some(ref t) = tracker_clone {
                        let mut to_emit: Option<PasswordUpdatePayload> = None;
                        if let Ok(mut lock) = t.lock() {
                            if let Some(ref tent) = lock.tentative_password {
                                let is_diff = match lock.initial_password {
                                    Some(ref init) => init != tent,
                                    None => !tent.is_empty(),
                                };
                                if is_diff && !tent.trim().is_empty() {
                                    to_emit = Some(PasswordUpdatePayload {
                                        host_id: lock.host_id.clone().unwrap_or_default(),
                                        host_name: lock.host_name.clone().unwrap_or_else(|| "服务器".to_string()),
                                        username: None,
                                        new_password: tent.clone(),
                                    });
                                }
                            }
                            lock.is_tracking = false;
                            lock.tentative_password = None;
                        }
                        if let Some(payload) = to_emit {
                            let _ = app_clone.emit("ssh-password-update-prompt", payload);
                        }
                    }
                }

                if !chunk.is_empty() {
                    let event_name = format!("pty-data-{}", sid_clone);
                    if app_clone.emit(&event_name, chunk).is_err() {
                        break;
                    }
                }
            }

            let exit_event = format!("pty-exit-{}", sid_clone);
            let _ = app_clone.emit(&exit_event, ());
        });

        let mut sessions = self.sessions.lock().unwrap();
        sessions.insert(
            session_id,
            PtySession {
                writer,
                master: pair.master,
                child,
                is_local: opts.is_local,
                pid,
                opts: opts.clone(),
                password_tracker: tracker,
                active_user,
            },
        );

        Ok(())
    }

    pub fn get_user(&self, session_id: &str) -> String {
        let sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.get(session_id) {
            if let Ok(guard) = session.active_user.lock() {
                return guard.clone();
            }
        }
        "unknown".to_string()
    }

    pub fn switch_user(
        &self,
        session_id: &str,
        target_user: &str,
        password: Option<String>,
    ) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.get(session_id) {
            let cmd = if target_user == "root" {
                "su -\n".to_string()
            } else {
                format!("su - {}\n", target_user)
            };

            if let Some(ref t) = session.password_tracker {
                if let Ok(mut lock) = t.lock() {
                    lock.target_switch_user = Some(target_user.to_string());
                    if let Some(ref pwd) = password {
                        lock.auto_switch_password = Some(pwd.clone());
                    }
                    lock.is_tracking = true;
                }
            }

            let mut writer = session.writer.lock().map_err(|e| e.to_string())?;
            writer.write_all(cmd.as_bytes()).map_err(|e| e.to_string())?;
            writer.flush().map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err("会话不存在".to_string())
        }
    }

    pub fn get_opts(&self, session_id: &str) -> Option<SpawnOptions> {
        let sessions = self.sessions.lock().unwrap();
        sessions.get(session_id).map(|s| s.opts.clone())
    }

    pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.get(session_id) {
            if let Some(ref t) = session.password_tracker {
                if let Ok(mut lock) = t.lock() {
                    lock.record_input(data);
                }
            }

            let mut writer = session.writer.lock().map_err(|e| e.to_string())?;
            writer
                .write_all(data.as_bytes())
                .map_err(|e| e.to_string())?;
            writer.flush().map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err("Session not found".to_string())
        }
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.get(session_id) {
            session
                .master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err("Session not found".to_string())
        }
    }

    pub fn close(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(mut session) = sessions.remove(session_id) {
            // Explicitly kill the child process (SSH or shell) to close server connection immediately!
            let _ = session.child.kill();
        }
        Ok(())
    }

    pub fn get_cwd_stats(&self, session_id: &str) -> (String, usize) {
        let sessions = self.sessions.lock().unwrap();
        let session = match sessions.get(session_id) {
            Some(s) => s,
            None => return ("~".to_string(), 0),
        };

        if session.is_local {
            if let Some(pid) = session.pid {
                #[cfg(target_os = "macos")]
                {
                    if let Ok(output) = std::process::Command::new("lsof")
                        .args(["-a", "-d", "cwd", "-p", &pid.to_string(), "-Fn"])
                        .output()
                    {
                        let text = String::from_utf8_lossy(&output.stdout);
                        for line in text.lines() {
                            if line.starts_with('n') && line.len() > 1 {
                                let path = &line[1..];
                                let p = PathBuf::from(path);
                                let count = std::fs::read_dir(&p).map(|d| d.count()).unwrap_or(0);
                                return (path.to_string(), count);
                            }
                        }
                    }
                }
            }
            if let Ok(home) = std::env::var("HOME") {
                let p = PathBuf::from(&home);
                let count = std::fs::read_dir(&p).map(|d| d.count()).unwrap_or(0);
                return ("~".to_string(), count);
            }
        }

        // For SSH sessions, default representation until SFTP probe is active
        ("~ (远程主目录)".to_string(), 0)
    }
}
