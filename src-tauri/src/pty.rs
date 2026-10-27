use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Deserialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

pub struct PtySession {
    pub writer: Box<dyn Write + Send>,
    pub master: Box<dyn MasterPty + Send>,
}

#[derive(Clone, Default)]
pub struct PtyManager {
    pub sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

#[derive(Debug, Deserialize)]
pub struct SpawnOptions {
    pub session_id: String,
    pub is_local: bool,
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
            let host = opts.host.ok_or_else(|| "Host is required for SSH".to_string())?;
            let port = opts.port.unwrap_or(22);
            let user = opts.username.unwrap_or_else(|| "root".to_string());

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

        let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);

        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

        let session_id = opts.session_id.clone();
        let app_clone = app.clone();
        let sid_clone = session_id.clone();

        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
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
            },
        );

        Ok(())
    }

    pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.get_mut(session_id) {
            session
                .writer
                .write_all(data.as_bytes())
                .map_err(|e| e.to_string())?;
            session.writer.flush().map_err(|e| e.to_string())?;
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
        sessions.remove(session_id);
        Ok(())
    }
}
