use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::net::{TcpStream, ToSocketAddrs};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::pty::SpawnOptions;

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

#[derive(Clone)]
pub struct SftpPool {
    // Cache active ssh2 sessions by session_id to make file operations instantaneous
    sessions: Arc<Mutex<HashMap<String, Arc<ssh2::Session>>>>,
}

impl SftpPool {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn get_or_connect(&self, opts: &SpawnOptions) -> Result<Arc<ssh2::Session>, String> {
        let mut map = self.sessions.lock().unwrap();
        if let Some(sess) = map.get(&opts.session_id) {
            // Check if still connected / alive
            if sess.authenticated() {
                return Ok(sess.clone());
            }
        }

        let host = opts.host.as_deref().unwrap_or("127.0.0.1");
        let port = opts.port.unwrap_or(22);
        let user = opts.username.as_deref().unwrap_or("root");

        let addr = format!("{}:{}", host, port)
            .to_socket_addrs()
            .map_err(|e| format!("无法解析地址 {}:{}: {}", host, port, e))?
            .next()
            .ok_or_else(|| format!("无法解析主机地址: {}", host))?;

        let tcp = TcpStream::connect_timeout(&addr, Duration::from_secs(3))
            .map_err(|e| format!("连接超时 (3s) {}:{}: {}", host, port, e))?;
        tcp.set_read_timeout(Some(Duration::from_secs(4))).ok();
        tcp.set_write_timeout(Some(Duration::from_secs(4))).ok();

        let mut sess = ssh2::Session::new().map_err(|e| e.to_string())?;
        sess.set_timeout(4000); // 4s timeout for SSH operations
        sess.set_tcp_stream(tcp);
        sess.handshake().map_err(|e| format!("SSH 握手失败: {}", e))?;

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
            return Err("SFTP 认证失败：无有效密码或私钥".to_string());
        }

        let arc_sess = Arc::new(sess);
        map.insert(opts.session_id.clone(), arc_sess.clone());
        Ok(arc_sess)
    }

    pub fn close(&self, session_id: &str) {
        let mut map = self.sessions.lock().unwrap();
        map.remove(session_id);
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
    let sess = pool.get_or_connect(opts)?;
    let sftp = sess.sftp().map_err(|e| format!("启动 SFTP 子系统失败: {}", e))?;

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

    let raw_entries = sftp.readdir(p).map_err(|e| format!("SFTP 目录读取失败 {}: {}", target_path, e))?;

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

pub fn read_file_preview_content(
    pool: &SftpPool,
    opts: &SpawnOptions,
    file_path: &str,
    max_bytes: usize,
) -> Result<String, String> {
    if opts.is_local {
        let mut f = fs::File::open(file_path).map_err(|e| format!("打开本地文件失败: {}", e))?;
        use std::io::Read;
        let mut buf = vec![0u8; max_bytes];
        let n = f.read(&mut buf).map_err(|e| format!("读取本地文件失败: {}", e))?;
        buf.truncate(n);
        String::from_utf8(buf).map_err(|_| "非文本文件或 UTF-8 解码失败".to_string())
    } else {
        let sess = pool.get_or_connect(opts)?;
        let sftp = sess.sftp().map_err(|e| format!("启动 SFTP 失败: {}", e))?;
        let mut file = sftp.open(Path::new(file_path)).map_err(|e| format!("打开远程文件失败: {}", e))?;
        use std::io::Read;
        let mut buf = vec![0u8; max_bytes];
        let n = file.read(&mut buf).map_err(|e| format!("读取远程文件失败: {}", e))?;
        buf.truncate(n);
        String::from_utf8(buf).map_err(|_| "非文本文件或 UTF-8 解码失败".to_string())
    }
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
