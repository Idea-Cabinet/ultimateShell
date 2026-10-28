use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::pty::SpawnOptions;
use crate::transfer::{TransferProgressPayload, TransferStatusPayload};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub size_formatted: String,
    pub mtime: i64,
    pub mtime_formatted: String,
    pub permissions: String,
    pub owner: String,
    pub file_type: String,
    pub ext: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirResult {
    pub current_path: String,
    pub parent_path: Option<String>,
    pub entries: Vec<FileEntry>,
    pub total_count: usize,
    pub total_dirs: usize,
    pub total_files: usize,
}

#[derive(Clone, Default)]
pub struct SftpPool {
    // Cache active ssh2 sessions by session_id with per-session Mutex to prevent race conditions on libssh2 socket
    sessions: Arc<Mutex<HashMap<String, Arc<Mutex<ssh2::Session>>>>>,
    // Cooldown map to prevent spamming failed TCP/SSH connections on wrong passwords or dead servers
    cooldowns: Arc<Mutex<HashMap<String, Instant>>>,
}

impl SftpPool {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            cooldowns: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn get_or_connect(&self, opts: &SpawnOptions) -> Result<Arc<Mutex<ssh2::Session>>, String> {
        // Step 1: Check existing session in map without holding map during health check
        let existing = {
            if let Ok(map) = self.sessions.lock() {
                map.get(&opts.session_id).cloned()
            } else {
                None
            }
        };

        if let Some(sess_arc) = existing {
            let is_authed = match sess_arc.try_lock() {
                Ok(sess) => sess.authenticated(),
                Err(std::sync::TryLockError::WouldBlock) => true,
                Err(std::sync::TryLockError::Poisoned(_)) => false,
            };
            if is_authed {
                return Ok(sess_arc);
            }
            // If dead or unauthenticated, clean from map
            if let Ok(mut map) = self.sessions.lock() {
                map.remove(&opts.session_id);
            }
        }

        // Step 2: Check failure cooldown to prevent hammering on wrong password or dead host
        {
            if let Ok(mut cd) = self.cooldowns.lock() {
                if let Some(t) = cd.get(&opts.session_id) {
                    if t.elapsed() < Duration::from_millis(3000) {
                        return Err("SFTP 连接失败冷却中，请稍后重试".to_string());
                    }
                    cd.remove(&opts.session_id);
                }
            }
        }

        // Step 3: Perform network connection OUTSIDE of self.sessions lock!
        let host = opts.host.as_deref().unwrap_or("127.0.0.1");
        let port = opts.port.unwrap_or(22);
        let user = opts.username.as_deref().unwrap_or("root");

        let addr = format!("{}:{}", host, port)
            .to_socket_addrs()
            .map_err(|e| format!("无法解析地址 {}:{}: {}", host, port, e))?
            .next()
            .ok_or_else(|| format!("无法解析主机地址: {}", host))?;

        let tcp = match TcpStream::connect_timeout(&addr, Duration::from_millis(2500)) {
            Ok(t) => t,
            Err(e) => {
                if let Ok(mut cd) = self.cooldowns.lock() {
                    cd.insert(opts.session_id.clone(), Instant::now());
                }
                return Err(format!("连接超时 (2.5s) {}:{}: {}", host, port, e));
            }
        };
        tcp.set_nodelay(true).ok();
        tcp.set_read_timeout(Some(Duration::from_millis(3500))).ok();
        tcp.set_write_timeout(Some(Duration::from_millis(3500))).ok();

        let mut sess = match ssh2::Session::new() {
            Ok(s) => s,
            Err(e) => return Err(e.to_string()),
        };
        sess.set_timeout(3500); // 3.5s timeout for SSH operations
        sess.set_tcp_stream(tcp);
        if let Err(e) = sess.handshake() {
            if let Ok(mut cd) = self.cooldowns.lock() {
                cd.insert(opts.session_id.clone(), Instant::now());
            }
            return Err(format!("SSH 握手失败: {}", e));
        }

        let mut authed = false;
        // 1. Try identity file
        if let Some(ref key_path) = opts.identity_file {
            if !key_path.trim().is_empty() {
                if sess.userauth_pubkey_file(user, None, Path::new(key_path), None).is_ok() {
                    authed = true;
                }
            }
        }

        // 2. Try hardware vault password
        if !authed {
            if let Some(ref hid) = opts.host_id {
                if let Some(pass) = crate::vault::get_password(hid) {
                    if sess.userauth_password(user, &pass).is_ok() {
                        authed = true;
                    }
                }
            }
        }

        // 3. Try SSH agent
        if !authed {
            if sess.userauth_agent(user).is_ok() {
                authed = true;
            }
        }

        if !authed {
            if let Ok(mut cd) = self.cooldowns.lock() {
                cd.insert(opts.session_id.clone(), Instant::now());
            }
            return Err("SFTP 认证失败：无有效密码或私钥".to_string());
        }

        let arc_sess = Arc::new(Mutex::new(sess));
        if let Ok(mut map) = self.sessions.lock() {
            map.insert(opts.session_id.clone(), arc_sess.clone());
        }
        Ok(arc_sess)
    }

    pub fn close(&self, session_id: &str) {
        if let Ok(mut map) = self.sessions.lock() {
            map.remove(session_id);
        }
        if let Ok(mut cd) = self.cooldowns.lock() {
            cd.remove(session_id);
        }
    }

    pub fn invalidate(&self, session_id: &str) {
        if let Ok(mut map) = self.sessions.lock() {
            map.remove(session_id);
        }
        if let Ok(mut cd) = self.cooldowns.lock() {
            cd.insert(session_id.to_string(), Instant::now());
        }
    }
}

pub fn format_size(size: u64, is_dir: bool) -> String {
    if is_dir {
        return "-".to_string();
    }
    if size < 1024 {
        format!("{} B", size)
    } else if size < 1024 * 1024 {
        format!("{:.1} KB", size as f64 / 1024.0)
    } else if size < 1024 * 1024 * 1024 {
        format!("{:.1} MB", size as f64 / (1024.0 * 1024.0))
    } else {
        format!("{:.2} GB", size as f64 / (1024.0 * 1024.0 * 1024.0))
    }
}

pub fn format_mtime(timestamp: i64) -> String {
    if let Some(utc) = DateTime::from_timestamp(timestamp, 0) {
        let local: DateTime<Local> = DateTime::from(utc);
        local.format("%Y-%m-%d %H:%M:%S").to_string()
    } else {
        "-".to_string()
    }
}

pub fn format_mode_string(mode: u32, is_dir: bool, is_symlink: bool) -> String {
    let mut s = String::with_capacity(10);
    if is_dir {
        s.push('d');
    } else if is_symlink {
        s.push('l');
    } else {
        s.push('-');
    }

    let flags = [
        (0o400, 'r'), (0o200, 'w'), (0o100, 'x'),
        (0o040, 'r'), (0o020, 'w'), (0o010, 'x'),
        (0o004, 'r'), (0o002, 'w'), (0o001, 'x'),
    ];

    for (mask, c) in flags {
        if mode & mask != 0 {
            s.push(c);
        } else {
            s.push('-');
        }
    }
    s
}

pub fn detect_file_type(name: &str, is_dir: bool, is_symlink: bool) -> (String, String) {
    if is_dir {
        return ("文件夹".to_string(), "".to_string());
    }
    if is_symlink {
        return ("符号链接".to_string(), "".to_string());
    }

    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let desc = match ext.as_str() {
        "sh" | "bash" | "zsh" => "Shell 脚本",
        "py" | "pyc" => "Python 脚本",
        "js" | "mjs" | "cjs" => "JavaScript 文件",
        "ts" | "tsx" => "TypeScript 文件",
        "rs" => "Rust 源代码",
        "json" => "JSON 配置文件",
        "yaml" | "yml" => "YAML 配置文件",
        "toml" | "ini" | "conf" | "cfg" => "配置文件",
        "md" | "markdown" => "Markdown 文档",
        "txt" | "text" => "文本文件",
        "log" => "日志文件",
        "tar" | "gz" | "tgz" | "zip" | "7z" | "rar" | "xz" => "压缩归档",
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" => "图像文件",
        "pdf" => "PDF 文档",
        "html" | "htm" => "HTML 页面",
        "css" | "scss" | "less" => "样式表文件",
        "sql" => "SQL 脚本",
        "db" | "sqlite" => "数据库文件",
        "service" => "Systemd 服务",
        "" => {
            if name.starts_with('.') {
                "隐藏配置"
            } else {
                "文件"
            }
        }
        _ => "文件",
    };

    (desc.to_string(), ext)
}

pub fn list_local_dir(req_path: &str, show_hidden: bool) -> Result<DirResult, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let target_path = if req_path.is_empty() || req_path == "~" || req_path == "." {
        home.clone()
    } else if req_path.starts_with("~/") {
        format!("{}{}", home, &req_path[1..])
    } else {
        req_path.to_string()
    };

    let p = PathBuf::from(&target_path);
    let canonical = p.canonicalize().unwrap_or(p.clone());
    let current_path_str = canonical.to_string_lossy().to_string();

    let parent_path = canonical.parent().map(|p| p.to_string_lossy().to_string());

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(&canonical).map_err(|e| format!("无法读取目录 {}: {}", current_path_str, e))?;

    for entry_res in read_dir {
        if let Ok(entry) = entry_res {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if !show_hidden && file_name.starts_with('.') {
                continue;
            }

            let path = entry.path();
            let is_symlink = entry.file_type().map(|ft| ft.is_symlink()).unwrap_or(false);
            let metadata = entry.metadata().ok();

            let is_dir = if let Some(ref meta) = metadata {
                meta.is_dir()
            } else {
                path.is_dir()
            };

            let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
            let mtime = metadata.as_ref().map(|m| m.mtime()).unwrap_or(0);
            let mode = metadata.as_ref().map(|m| m.permissions().mode()).unwrap_or(0o644);
            let uid = metadata.as_ref().map(|m| m.uid()).unwrap_or(0);
            let gid = metadata.as_ref().map(|m| m.gid()).unwrap_or(0);

            let (file_type, ext) = detect_file_type(&file_name, is_dir, is_symlink);

            entries.push(FileEntry {
                name: file_name,
                path: path.to_string_lossy().to_string(),
                is_dir,
                is_symlink,
                size,
                size_formatted: format_size(size, is_dir),
                mtime,
                mtime_formatted: format_mtime(mtime),
                permissions: format_mode_string(mode, is_dir, is_symlink),
                owner: format!("{}:{}", uid, gid),
                file_type,
                ext,
            });
        }
    }

    // Sort: directories first, then alphabetical (case-insensitive)
    entries.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir)
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    let total_dirs = entries.iter().filter(|e| e.is_dir).count();
    let total_files = entries.len() - total_dirs;

    Ok(DirResult {
        current_path: current_path_str,
        parent_path,
        total_count: entries.len(),
        total_dirs,
        total_files,
        entries,
    })
}

pub fn list_remote_dir(
    pool: &SftpPool,
    opts: &SpawnOptions,
    req_path: &str,
    show_hidden: bool,
) -> Result<DirResult, String> {
    let sess_arc = match pool.get_or_connect(opts) {
        Ok(s) => s,
        Err(e) => return Err(e),
    };
    let sess = sess_arc.lock().map_err(|e| e.to_string())?;
    let sftp = match sess.sftp() {
        Ok(s) => s,
        Err(e) => {
            drop(sess);
            pool.invalidate(&opts.session_id);
            return Err(format!("启动 SFTP 子系统失败: {}", e));
        }
    };

    let target_path = if req_path.is_empty() || req_path == "~" || req_path == "." {
        // Resolve remote home path
        sftp.realpath(Path::new("."))
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| "/root".to_string())
    } else {
        req_path.to_string()
    };

    let p = Path::new(&target_path);
    let current_path_str = target_path.clone();
    let parent_path = p.parent().map(|p| {
        let s = p.to_string_lossy().to_string();
        if s.is_empty() { "/".to_string() } else { s }
    });

    let raw_entries = match sftp.readdir(p) {
        Ok(entries) => entries,
        Err(e) => {
            drop(sftp);
            drop(sess);
            pool.invalidate(&opts.session_id);
            return Err(format!("SFTP 目录读取失败 {}: {}", target_path, e));
        }
    };

    let mut entries = Vec::new();
    for (entry_path, stat) in raw_entries {
        let file_name = entry_path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        if file_name.is_empty() || file_name == "." || file_name == ".." {
            continue;
        }

        if !show_hidden && file_name.starts_with('.') {
            continue;
        }

        let is_dir = stat.is_dir();
        let is_symlink = stat.file_type() == ssh2::FileType::Symlink;
        let size = stat.size.unwrap_or(0);
        let mtime = stat.mtime.unwrap_or(0) as i64;
        let mode = stat.perm.unwrap_or(if is_dir { 0o755 } else { 0o644 });
        let uid = stat.uid.unwrap_or(0);
        let gid = stat.gid.unwrap_or(0);

        let (file_type, ext) = detect_file_type(&file_name, is_dir, is_symlink);

        entries.push(FileEntry {
            name: file_name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir,
            is_symlink,
            size,
            size_formatted: format_size(size, is_dir),
            mtime,
            mtime_formatted: format_mtime(mtime),
            permissions: format_mode_string(mode, is_dir, is_symlink),
            owner: format!("{}:{}", uid, gid),
            file_type,
            ext,
        });
    }

    entries.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir)
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    let total_dirs = entries.iter().filter(|e| e.is_dir).count();
    let total_files = entries.len() - total_dirs;

    Ok(DirResult {
        current_path: current_path_str,
        parent_path,
        total_count: entries.len(),
        total_dirs,
        total_files,
        entries,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreviewResult {
    pub content: String,
    pub total_size: u64,
    pub is_truncated: bool,
    pub mode: String,
    pub line_count: usize,
}

pub fn read_file_preview_content(
    pool: &SftpPool,
    opts: &SpawnOptions,
    file_path: &str,
    mode: Option<String>,
    max_bytes: Option<usize>,
) -> Result<PreviewResult, String> {
    let target = resolve_path_str(pool, opts, file_path);
    let max_b = max_bytes.unwrap_or(128 * 1024);
    let is_log = target.ends_with(".log")
        || target.ends_with(".out")
        || target.ends_with(".err")
        || target.contains("/log/")
        || target.ends_with("syslog")
        || target.ends_with("messages");

    if opts.is_local {
        let mut f = fs::File::open(&target).map_err(|e| format!("打开本地文件失败: {}", e))?;
        let meta = f.metadata().map_err(|e| format!("读取文件元信息失败: {}", e))?;
        let total_size = meta.len();

        let chosen_mode = mode.unwrap_or_else(|| {
            if is_log && total_size > max_b as u64 {
                "tail".to_string()
            } else {
                "head".to_string()
            }
        });

        let (buf, is_truncated) = if total_size <= max_b as u64 {
            let mut b = Vec::with_capacity(total_size as usize);
            f.read_to_end(&mut b).map_err(|e| format!("读取本地文件失败: {}", e))?;
            (b, false)
        } else if chosen_mode == "tail" {
            let offset = total_size.saturating_sub(max_b as u64);
            let _ = f.seek(SeekFrom::Start(offset));
            let mut b = vec![0u8; max_b];
            let n = f.read(&mut b).map_err(|e| format!("读取本地文件失败: {}", e))?;
            b.truncate(n);
            (b, true)
        } else {
            let mut b = vec![0u8; max_b];
            let n = f.read(&mut b).map_err(|e| format!("读取本地文件失败: {}", e))?;
            b.truncate(n);
            (b, true)
        };

        let mut content = String::from_utf8_lossy(&buf).to_string();
        if is_truncated && chosen_mode == "tail" {
            if let Some(pos) = content.find('\n') {
                content = content[pos + 1..].to_string();
            }
        }
        let line_count = content.lines().count();
        Ok(PreviewResult {
            content,
            total_size,
            is_truncated,
            mode: chosen_mode,
            line_count,
        })
    } else {
        let sess_arc = pool.get_or_connect(opts)?;
        let sess = sess_arc.lock().map_err(|e| e.to_string())?;

        // 1. Try reading via SFTP (fastest, with seek support)
        let mut sftp_preview: Option<PreviewResult> = None;
        if let Ok(sftp) = sess.sftp() {
            if let Ok(mut file) = sftp.open(Path::new(&target)) {
                if let Ok(stat) = file.stat() {
                    let total_size = stat.size.unwrap_or(0);
                    let chosen_mode = mode.clone().unwrap_or_else(|| {
                        if is_log && total_size > max_b as u64 {
                            "tail".to_string()
                        } else {
                            "head".to_string()
                        }
                    });

                    let (buf, is_truncated) = if total_size <= max_b as u64 {
                        let mut b = Vec::with_capacity(total_size as usize);
                        let _ = file.read_to_end(&mut b);
                        (b, false)
                    } else if chosen_mode == "tail" {
                        let offset = total_size.saturating_sub(max_b as u64);
                        let _ = file.seek(SeekFrom::Start(offset));
                        let mut b = vec![0u8; max_b];
                        let n = file.read(&mut b).unwrap_or(0);
                        b.truncate(n);
                        (b, true)
                    } else {
                        let mut b = vec![0u8; max_b];
                        let n = file.read(&mut b).unwrap_or(0);
                        b.truncate(n);
                        (b, true)
                    };

                    let mut content = String::from_utf8_lossy(&buf).to_string();
                    if is_truncated && chosen_mode == "tail" {
                        if let Some(pos) = content.find('\n') {
                            content = content[pos + 1..].to_string();
                        }
                    }
                    let line_count = content.lines().count();
                    sftp_preview = Some(PreviewResult {
                        content,
                        total_size,
                        is_truncated,
                        mode: chosen_mode,
                        line_count,
                    });
                }
            }
        }

        if let Some(res) = sftp_preview {
            return Ok(res);
        }

        // 2. Fallback to SSH command (handles permission-restricted /var/log/* and protected logs)
        let safe_path = target.replace('\'', "'\\''");
        let chosen_mode = mode.unwrap_or_else(|| {
            if is_log {
                "tail".to_string()
            } else {
                "head".to_string()
            }
        });

        let cmd = if chosen_mode == "tail" {
            format!(
                "tail -c {} '{}' 2>/dev/null || sudo -n tail -c {} '{}' 2>/dev/null",
                max_b, safe_path, max_b, safe_path
            )
        } else {
            format!(
                "head -c {} '{}' 2>/dev/null || sudo -n head -c {} '{}' 2>/dev/null",
                max_b, safe_path, max_b, safe_path
            )
        };

        if let Ok(mut ch) = sess.channel_session() {
            if ch.exec(&cmd).is_ok() {
                let mut buf = Vec::with_capacity(max_b);
                let _ = ch.read_to_end(&mut buf);
                let _ = ch.wait_close();
                if !buf.is_empty() {
                    let mut content = String::from_utf8_lossy(&buf).to_string();
                    let is_truncated = buf.len() >= max_b;
                    if is_truncated && chosen_mode == "tail" {
                        if let Some(pos) = content.find('\n') {
                            content = content[pos + 1..].to_string();
                        }
                    }
                    let line_count = content.lines().count();
                    return Ok(PreviewResult {
                        content,
                        total_size: buf.len() as u64,
                        is_truncated,
                        mode: chosen_mode,
                        line_count,
                    });
                }
            }
        }

        Err(format!("打开或读取远程文件失败 (权限不足或文件不存在): {}", target))
    }
}

pub fn rename_file(
    pool: &SftpPool,
    opts: &SpawnOptions,
    old_path: &str,
    new_path: &str,
) -> Result<(), String> {
    if opts.is_local {
        fs::rename(old_path, new_path)
            .map_err(|e| format!("重命名本地文件失败: {}", e))
    } else {
        let sess_arc = pool.get_or_connect(opts)?;
        let sess = sess_arc.lock().map_err(|e| e.to_string())?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP 会话错误: {}", e))?;
        sftp.rename(Path::new(old_path), Path::new(new_path), None)
            .map_err(|e| format!("重命名远程文件失败: {}", e))
    }
}

pub fn resolve_path_str(pool: &SftpPool, opts: &SpawnOptions, raw_path: &str) -> String {
    let clean = raw_path.trim();
    if opts.is_local {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
        if clean.is_empty() || clean == "~" || clean == "." {
            home
        } else if clean.starts_with("~/") {
            format!("{}/{}", home.trim_end_matches('/'), &clean[2..])
        } else if clean.starts_with('~') {
            format!("{}/{}", home.trim_end_matches('/'), &clean[1..].trim_start_matches('/'))
        } else {
            clean.to_string()
        }
    } else {
        // Remote path resolution
        if clean.starts_with('~') || clean.is_empty() || clean == "." {
            let home = if let Ok(sess_arc) = pool.get_or_connect(opts) {
                if let Ok(sess) = sess_arc.lock() {
                    if let Ok(sftp) = sess.sftp() {
                        sftp.realpath(Path::new("."))
                            .map(|p| p.to_string_lossy().to_string())
                            .unwrap_or_else(|_| "/root".to_string())
                    } else {
                        "/root".to_string()
                    }
                } else {
                    "/root".to_string()
                }
            } else {
                "/root".to_string()
            };

            if clean.is_empty() || clean == "~" || clean == "." {
                home
            } else if clean.starts_with("~/") {
                format!("{}/{}", home.trim_end_matches('/'), &clean[2..])
            } else {
                format!("{}/{}", home.trim_end_matches('/'), &clean[1..].trim_start_matches('/'))
            }
        } else {
            clean.to_string()
        }
    }
}

pub fn create_file(
    pool: &SftpPool,
    opts: &SpawnOptions,
    file_path: &str,
) -> Result<(), String> {
    let target = resolve_path_str(pool, opts, file_path);
    println!("[sftp::create_file] raw='{}' -> target='{}' is_local={}", file_path, target, opts.is_local);

    if opts.is_local {
        fs::File::create(&target)
            .map_err(|e| {
                println!("[sftp::create_file] 本地创建文件失败: {}", e);
                format!("创建本地文件失败: {}", e)
            })?;
        println!("[sftp::create_file] 本地创建文件成功: {}", target);
        Ok(())
    } else {
        let sess_arc = pool.get_or_connect(opts)?;
        let sess = sess_arc.lock().map_err(|e| e.to_string())?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP 会话错误: {}", e))?;
        match sftp.create(Path::new(&target)) {
            Ok(file) => {
                drop(file);
                println!("[sftp::create_file] 远程文件通过 SFTP 创建成功: {}", target);
                Ok(())
            }
            Err(e) => {
                println!("[sftp::create_file] SFTP 创建失败 ({}): {}，尝试 SSH touch 回退...", target, e);
                // Fallback to touch / sudo -n touch
                let safe_path = target.replace('\'', "'\\''");
                if let Ok(mut ch) = sess.channel_session() {
                    let cmd = format!("touch '{}' 2>/dev/null || sudo -n touch '{}' 2>/dev/null", safe_path, safe_path);
                    if ch.exec(&cmd).is_ok() {
                        let mut output = String::new();
                        let _ = ch.read_to_string(&mut output);
                        let _ = ch.wait_close();
                        if ch.exit_status().unwrap_or(1) == 0 {
                            println!("[sftp::create_file] 远程文件通过 SSH touch 回退创建成功: {}", target);
                            return Ok(());
                        }
                    }
                }
                println!("[sftp::create_file] 远程文件创建最终失败: {}", e);
                Err(format!("创建远程文件失败: {}", e))
            }
        }
    }
}

pub fn create_dir(
    pool: &SftpPool,
    opts: &SpawnOptions,
    dir_path: &str,
) -> Result<(), String> {
    let target = resolve_path_str(pool, opts, dir_path);
    let target_clean = target.trim_end_matches('/').to_string();
    println!("[sftp::create_dir] raw='{}' -> target='{}' is_local={}", dir_path, target_clean, opts.is_local);

    if opts.is_local {
        fs::create_dir_all(&target_clean)
            .map_err(|e| {
                println!("[sftp::create_dir] 本地创建文件夹失败: {}", e);
                format!("创建本地文件夹失败: {}", e)
            })?;
        println!("[sftp::create_dir] 本地创建文件夹成功: {}", target_clean);
        Ok(())
    } else {
        let sess_arc = pool.get_or_connect(opts)?;
        let sess = sess_arc.lock().map_err(|e| e.to_string())?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP 会话错误: {}", e))?;
        match sftp.mkdir(Path::new(&target_clean), 0o755) {
            Ok(_) => {
                println!("[sftp::create_dir] 远程文件夹通过 SFTP 创建成功: {}", target_clean);
                Ok(())
            }
            Err(e) => {
                println!("[sftp::create_dir] SFTP mkdir 失败 ({}): {}，尝试 SSH mkdir -p 回退...", target_clean, e);
                let safe_path = target_clean.replace('\'', "'\\''");
                if let Ok(mut ch) = sess.channel_session() {
                    let cmd = format!("mkdir -p '{}' 2>/dev/null || sudo -n mkdir -p '{}' 2>/dev/null", safe_path, safe_path);
                    if ch.exec(&cmd).is_ok() {
                        let mut output = String::new();
                        let _ = ch.read_to_string(&mut output);
                        let _ = ch.wait_close();
                        if ch.exit_status().unwrap_or(1) == 0 {
                            println!("[sftp::create_dir] 远程文件夹通过 SSH mkdir -p 回退创建成功: {}", target_clean);
                            return Ok(());
                        }
                    }
                }
                println!("[sftp::create_dir] 远程文件夹创建最终失败: {}", e);
                Err(format!("创建远程文件夹失败: {}", e))
            }
        }
    }
}

pub fn delete_entry(
    pool: &SftpPool,
    opts: &SpawnOptions,
    path_str: &str,
    is_dir: bool,
    use_trash: bool,
) -> Result<String, String> {
    let target = resolve_path_str(pool, opts, path_str);
    let target_clean = target.trim_end_matches('/').to_string();
    println!("[sftp::delete_entry] target='{}', is_dir={}, use_trash={}, is_local={}", target_clean, is_dir, use_trash, opts.is_local);

    let trash_dir = std::env::var("HOME")
        .map(|h| format!("{}/.ultimateshell/trash", h))
        .unwrap_or_else(|_| ".ultimateshell_trash".to_string());

    if use_trash {
        let _ = fs::create_dir_all(&trash_dir);
    }

    let item_name = Path::new(&target_clean)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| "unnamed".to_string());

    let now_str = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let trash_item_path = format!("{}/{}_{}", trash_dir, now_str, item_name);

    if opts.is_local {
        if use_trash {
            if is_dir {
                // Move local directory to trash
                let _ = fs::rename(&target_clean, &trash_item_path);
                println!("[sftp::delete_entry] 本地文件夹已移至回收站: {}", trash_item_path);
                return Ok(format!("已移至本地回收站: {}", trash_item_path));
            } else {
                // For local file, rename into trash
                match fs::rename(&target_clean, &trash_item_path) {
                    Ok(_) => {
                        println!("[sftp::delete_entry] 本地文件已移至回收站: {}", trash_item_path);
                        return Ok(format!("已移至本地回收站: {}", trash_item_path));
                    }
                    Err(_) => {
                        let _ = fs::copy(&target_clean, &trash_item_path);
                        let _ = fs::remove_file(&target_clean);
                        return Ok(format!("已备份至本地回收站并删除: {}", trash_item_path));
                    }
                }
            }
        } else {
            // Direct permanent delete
            if is_dir {
                fs::remove_dir_all(&target_clean)
                    .map_err(|e| format!("删除本地文件夹失败: {}", e))?;
                println!("[sftp::delete_entry] 本地文件夹已永久删除: {}", target_clean);
            } else {
                fs::remove_file(&target_clean)
                    .map_err(|e| format!("删除本地文件失败: {}", e))?;
                println!("[sftp::delete_entry] 本地文件已永久删除: {}", target_clean);
            }
            return Ok("已永久删除".to_string());
        }
    } else {
        // Remote SFTP
        let sess_arc = pool.get_or_connect(opts)?;
        let sess = sess_arc.lock().map_err(|e| e.to_string())?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP 会话错误: {}", e))?;

        if use_trash {
            if !is_dir {
                // Download file content into local trash file first
                if let Ok(mut remote_file) = sftp.open(Path::new(&target_clean)) {
                    if let Ok(mut local_trash_file) = fs::File::create(&trash_item_path) {
                        let mut buf = [0u8; 32768];
                        loop {
                            match remote_file.read(&mut buf) {
                                Ok(0) => break,
                                Ok(n) => {
                                    if local_trash_file.write_all(&buf[..n]).is_err() {
                                        break;
                                    }
                                }
                                Err(_) => break,
                            }
                        }
                        println!("[sftp::delete_entry] 远程文件已先下载备份至本地回收站: {}", trash_item_path);
                    }
                }
            } else {
                // For remote dir, tar and download into trash
                if let Ok(mut ch) = sess.channel_session() {
                    let cmd = format!("tar -czf - -C '{}' . 2>/dev/null", target_clean);
                    if ch.exec(&cmd).is_ok() {
                        let trash_tar_path = format!("{}.tar.gz", trash_item_path);
                        if let Ok(mut local_tar) = fs::File::create(&trash_tar_path) {
                            let mut buf = [0u8; 32768];
                            loop {
                                match ch.read(&mut buf) {
                                    Ok(0) => break,
                                    Ok(n) => {
                                        if local_tar.write_all(&buf[..n]).is_err() {
                                            break;
                                        }
                                    }
                                    Err(_) => break,
                                }
                            }
                            let _ = ch.wait_close();
                            println!("[sftp::delete_entry] 远程文件夹已打包备份至本地回收站: {}", trash_tar_path);
                        }
                    }
                }
            }
        }

        // Now perform remote deletion
        if is_dir {
            // SFTP rmdir only removes empty dirs, so run SSH rm -rf for robust recursive deletion
            let safe_path = target_clean.replace('\'', "'\\''");
            if let Ok(mut ch) = sess.channel_session() {
                let cmd = format!("rm -rf '{}' || sudo -n rm -rf '{}'", safe_path, safe_path);
                if ch.exec(&cmd).is_ok() {
                    let mut out = String::new();
                    let _ = ch.read_to_string(&mut out);
                    let _ = ch.wait_close();
                    if ch.exit_status().unwrap_or(1) == 0 {
                        println!("[sftp::delete_entry] 远程文件夹已通过 SSH rm -rf 删除成功: {}", target_clean);
                        return Ok(if use_trash { "已备份至本地回收站并从服务器删除".to_string() } else { "已从服务器永久删除".to_string() });
                    }
                }
            }
            // Fallback to sftp.rmdir
            sftp.rmdir(Path::new(&target_clean))
                .map_err(|e| format!("删除远程文件夹失败: {}", e))?;
            println!("[sftp::delete_entry] 远程文件夹通过 SFTP rmdir 删除成功: {}", target_clean);
        } else {
            // SFTP unlink for file
            match sftp.unlink(Path::new(&target_clean)) {
                Ok(_) => {
                    println!("[sftp::delete_entry] 远程文件已通过 SFTP unlink 删除成功: {}", target_clean);
                }
                Err(e) => {
                    println!("[sftp::delete_entry] SFTP unlink 失败: {}，尝试 SSH rm -f 回退...", e);
                    let safe_path = target_clean.replace('\'', "'\\''");
                    if let Ok(mut ch) = sess.channel_session() {
                        let cmd = format!("rm -f '{}' || sudo -n rm -f '{}'", safe_path, safe_path);
                        if ch.exec(&cmd).is_ok() {
                            let mut out = String::new();
                            let _ = ch.read_to_string(&mut out);
                            let _ = ch.wait_close();
                            if ch.exit_status().unwrap_or(1) == 0 {
                                println!("[sftp::delete_entry] 远程文件通过 SSH rm -f 删除成功: {}", target_clean);
                                return Ok(if use_trash { "已备份至本地回收站并从服务器删除".to_string() } else { "已从服务器永久删除".to_string() });
                            }
                        }
                    }
                    return Err(format!("删除远程文件失败: {}", e));
                }
            }
        }
        Ok(if use_trash { "已备份至本地回收站并从服务器删除".to_string() } else { "已从服务器永久删除".to_string() })
    }
}

pub fn download_file(
    app: AppHandle,
    pool: &SftpPool,
    opts: &SpawnOptions,
    remote_path: &str,
    local_path: &str,
    task_id: &str,
    cancel_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    use std::io::{Read, Write};
    let chunk_size = 64 * 1024; // 64KB
    let mut buf = vec![0u8; chunk_size];

    let (mut reader, total_size): (Box<dyn Read + Send>, u64) = if opts.is_local {
        let f = fs::File::open(remote_path).map_err(|e| format!("打开本地源文件失败: {}", e))?;
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        (Box::new(f), len)
    } else {
        let sess_arc = pool.get_or_connect(opts)?;
        let sess = sess_arc.lock().map_err(|e| e.to_string())?;
        let sftp = match sess.sftp() {
            Ok(s) => s,
            Err(e) => {
                drop(sess);
                pool.invalidate(&opts.session_id);
                return Err(format!("启动 SFTP 失败: {}", e));
            }
        };
        let mut f = match sftp.open(Path::new(remote_path)) {
            Ok(file) => file,
            Err(e) => {
                drop(sftp);
                drop(sess);
                pool.invalidate(&opts.session_id);
                return Err(format!("打开远程源文件失败: {}", e));
            }
        };
        let len = f.stat().map(|st| st.size.unwrap_or(0)).unwrap_or(0);
        (Box::new(f), len)
    };

    if let Some(parent) = Path::new(local_path).parent() {
        let _ = fs::create_dir_all(parent);
    }

    let mut writer = fs::File::create(local_path)
        .map_err(|e| format!("创建本地目标文件失败: {}", e))?;

    let mut transferred: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    let mut last_bytes = 0u64;

    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            drop(writer);
            let _ = fs::remove_file(local_path);
            let _ = app.emit(
                "file-transfer-status",
                TransferStatusPayload {
                    task_id: task_id.to_string(),
                    status: "cancelled".to_string(),
                    error: Some("用户已取消传输".to_string()),
                },
            );
            return Err("传输已取消".to_string());
        }

        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("读取文件块失败: {}", e))?;
        if n == 0 {
            break;
        }

        writer
            .write_all(&buf[..n])
            .map_err(|e| format!("写入本地文件块失败: {}", e))?;
        transferred += n as u64;

        let elapsed = last_emit.elapsed();
        if elapsed.as_millis() >= 120 || transferred == total_size {
            let bytes_since = transferred.saturating_sub(last_bytes);
            let speed = if elapsed.as_secs_f64() > 0.0 {
                (bytes_since as f64 / elapsed.as_secs_f64()) as u64
            } else {
                0
            };
            last_emit = std::time::Instant::now();
            last_bytes = transferred;

            let _ = app.emit(
                "file-transfer-progress",
                TransferProgressPayload {
                    task_id: task_id.to_string(),
                    transferred,
                    total: total_size,
                    speed,
                },
            );
        }
    }

    let _ = writer.flush();
    let _ = app.emit(
        "file-transfer-status",
        TransferStatusPayload {
            task_id: task_id.to_string(),
            status: "completed".to_string(),
            error: None,
        },
    );

    Ok(())
}

pub fn upload_file(
    app: AppHandle,
    pool: &SftpPool,
    opts: &SpawnOptions,
    local_path: &str,
    remote_path: &str,
    task_id: &str,
    cancel_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    use std::io::{Read, Write};
    let chunk_size = 64 * 1024; // 64KB
    let mut buf = vec![0u8; chunk_size];

    let mut local_file =
        fs::File::open(local_path).map_err(|e| format!("打开本地源文件失败: {}", e))?;
    let total_size = local_file.metadata().map(|m| m.len()).unwrap_or(0);

    let mut writer: Box<dyn Write + Send> = if opts.is_local {
        if let Some(parent) = Path::new(remote_path).parent() {
            let _ = fs::create_dir_all(parent);
        }
        let f = fs::File::create(remote_path)
            .map_err(|e| format!("创建本地目标文件失败: {}", e))?;
        Box::new(f)
    } else {
        let sess_arc = pool.get_or_connect(opts)?;
        let sess = sess_arc.lock().map_err(|e| e.to_string())?;
        let sftp = match sess.sftp() {
            Ok(s) => s,
            Err(e) => {
                drop(sess);
                pool.invalidate(&opts.session_id);
                return Err(format!("启动 SFTP 失败: {}", e));
            }
        };
        let f = match sftp.create(Path::new(remote_path)) {
            Ok(file) => file,
            Err(e) => {
                drop(sftp);
                drop(sess);
                pool.invalidate(&opts.session_id);
                return Err(format!("创建远程目标文件失败: {}", e));
            }
        };
        Box::new(f)
    };

    let mut transferred: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    let mut last_bytes = 0u64;

    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            let _ = app.emit(
                "file-transfer-status",
                TransferStatusPayload {
                    task_id: task_id.to_string(),
                    status: "cancelled".to_string(),
                    error: Some("用户已取消传输".to_string()),
                },
            );
            return Err("传输已取消".to_string());
        }

        let n = local_file
            .read(&mut buf)
            .map_err(|e| format!("读取本地源文件块失败: {}", e))?;
        if n == 0 {
            break;
        }

        writer
            .write_all(&buf[..n])
            .map_err(|e| format!("写入远程文件块失败: {}", e))?;
        transferred += n as u64;

        let elapsed = last_emit.elapsed();
        if elapsed.as_millis() >= 120 || transferred == total_size {
            let bytes_since = transferred.saturating_sub(last_bytes);
            let speed = if elapsed.as_secs_f64() > 0.0 {
                (bytes_since as f64 / elapsed.as_secs_f64()) as u64
            } else {
                0
            };
            last_emit = std::time::Instant::now();
            last_bytes = transferred;

            let _ = app.emit(
                "file-transfer-progress",
                TransferProgressPayload {
                    task_id: task_id.to_string(),
                    transferred,
                    total: total_size,
                    speed,
                },
            );
        }
    }

    let _ = writer.flush();
    let _ = app.emit(
        "file-transfer-status",
        TransferStatusPayload {
            task_id: task_id.to_string(),
            status: "completed".to_string(),
            error: None,
        },
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_local_dir() {
        let res = list_local_dir(".", false).expect("Should list current dir");
        assert!(res.total_count > 0);
        println!("Listed {} entries in {}", res.total_count, res.current_path);
        for entry in res.entries.iter().take(5) {
            println!("- {} [{}] ({})", entry.name, entry.file_type, entry.size_formatted);
        }
    }
}
