use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Default)]
pub struct PasswordTracker {
    pub is_tracking: bool,
    pub current_input: String,
    pub tentative_password: Option<String>,
    pub initial_password: Option<String>,
    pub host_id: Option<String>,
    pub host_name: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct PasswordUpdatePayload {
    pub host_id: String,
    pub host_name: String,
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
            Some(Arc::new(Mutex::new(PasswordTracker {
                is_tracking: saved_password.is_none(),
                current_input: String::new(),
                tentative_password: None,
                initial_password: saved_password.clone(),
                host_id: opts.host_id.clone(),
                host_name: opts.host_name.clone(),
            })))
        } else {
            None
        };
        let tracker_clone = tracker.clone();

        let writer_clone = Arc::clone(&writer);
        let password_sent = Arc::new(AtomicBool::new(false));

        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                let lower = chunk.to_lowercase();

                // 1. Auto-fill password if SSH prompts for password
                if let Some(ref pwd) = saved_password {
                    if !password_sent.load(Ordering::SeqCst) {
                        if lower.contains("password:") || lower.contains("密码:") {
                            password_sent.store(true, Ordering::SeqCst);
                            let pwd_to_send = format!("{}\n", pwd);
                            let w = Arc::clone(&writer_clone);
                            thread::spawn(move || {
                                thread::sleep(Duration::from_millis(100));
                                if let Ok(mut lock) = w.lock() {
                                    let _ = lock.write_all(pwd_to_send.as_bytes());
                                    let _ = lock.flush();
                                }
                            });
                        }
                    }
                }

                // 2. If password rejected / permission denied:
                // DO NOT RETRY! Let the user type manually, and start tracking their input.
                if lower.contains("permission denied")
                    || lower.contains("please try again")
                    || lower.contains("authentication failed")
                    || lower.contains("access denied")
                {
                    if let Some(ref t) = tracker_clone {
                        if let Ok(mut lock) = t.lock() {
                            lock.is_tracking = true;
                            lock.tentative_password = None;
                            lock.current_input.clear();
                        }
                    }
                }

                // 3. Detect login success:
                let is_password_prompt = lower.contains("password:") || lower.contains("密码:");
                let is_login_success = !is_password_prompt && (
                    lower.contains("last login:")
                    || lower.contains("welcome to")
                    || lower.contains("linux ")
                    || (lower.contains("@") && (chunk.contains("$ ") || chunk.contains("# ") || chunk.ends_with('$') || chunk.ends_with('#')))
                    || chunk.contains("]$")
                    || chunk.contains("]#")
                    || chunk.contains("~#")
                    || chunk.contains("~$")
                );

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

                let event_name = format!("pty-data-{}", sid_clone);
                if app_clone.emit(&event_name, chunk).is_err() {
                    break;
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
            },
        );

        Ok(())
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
                    if lock.is_tracking {
                        for c in data.chars() {
                            if c == '\r' || c == '\n' {
                                if !lock.current_input.is_empty() {
                                    lock.tentative_password = Some(lock.current_input.clone());
                                    lock.current_input.clear();
                                }
                            } else if c == '\x08' || c == '\x7f' {
                                lock.current_input.pop();
                            } else if c == '\x03' || c == '\x15' {
                                lock.current_input.clear();
                            } else if !c.is_control() {
                                lock.current_input.push(c);
                            }
                        }
                    }
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
