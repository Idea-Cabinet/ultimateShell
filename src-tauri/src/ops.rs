use serde::{Deserialize, Serialize};
use std::io::Read;

use crate::pty::SpawnOptions;
use crate::sftp::SftpPool;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessEntry {
    pub pid: u32,
    pub user: string_clean::SafeString,
    pub cpu: f64,
    pub mem: f64,
    pub stat: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskPartition {
    pub filesystem: String,
    pub mount_point: String,
    pub total: String,
    pub used: String,
    pub avail: String,
    pub use_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerUser {
    pub username: String,
    pub uid: u32,
    pub gid: u32,
    pub home: String,
    pub shell: String,
    pub is_root: bool,
    pub is_login_user: bool,
    pub has_password: bool,
}

// Module for clean string serialization
mod string_clean {
    pub type SafeString = String;
}

pub fn get_processes(pool: &SftpPool, opts: &SpawnOptions) -> Result<Vec<ProcessEntry>, String> {
    let output = if opts.is_local {
        #[cfg(target_os = "macos")]
        {
            let res = std::process::Command::new("ps")
                .args(["-axo", "pid,user,%cpu,%mem,state,command"])
                .output()
                .map_err(|e| format!("无法执行本地 ps: {}", e))?;
            String::from_utf8_lossy(&res.stdout).to_string()
        }
        #[cfg(not(target_os = "macos"))]
        {
            String::new()
        }
    } else {
        let sess_arc = pool.get_or_connect(opts)?;
        let sess = sess_arc.lock().map_err(|e| e.to_string())?;
        let mut channel = match sess.channel_session() {
            Ok(c) => c,
            Err(e) => {
                drop(sess);
                pool.invalidate(&opts.session_id);
                return Err(format!("无法创建 SSH 通道: {}", e));
            }
        };

        if let Err(e) = channel.exec("ps -eo pid,user,pcpu,pmem,stat,args --sort=-pcpu 2>/dev/null || ps -axo pid,user,%cpu,%mem,state,command") {
            drop(channel);
            drop(sess);
            pool.invalidate(&opts.session_id);
            return Err(format!("无法在远程执行 ps 命令: {}", e));
        }

        let mut s = String::new();
        channel.read_to_string(&mut s).ok();
        channel.wait_close().ok();
        s
    };

    let mut entries = Vec::new();
    let lines: Vec<&str> = output.lines().collect();
    if lines.is_empty() {
        return Ok(entries);
    }

    // Skip header line
    for line in lines.into_iter().skip(1) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() >= 6 {
            let pid = parts[0].parse::<u32>().unwrap_or(0);
            if pid == 0 {
                continue;
            }
            let user = parts[1].to_string();
            let cpu = parts[2].parse::<f64>().unwrap_or(0.0);
            let mem = parts[3].parse::<f64>().unwrap_or(0.0);
            let stat = parts[4].to_string();
            let command = parts[5..].join(" ");

            entries.push(ProcessEntry {
                pid,
                user,
                cpu,
                mem,
                stat,
                command,
            });
        }
    }

    Ok(entries)
}

pub fn kill_proc(
    pool: &SftpPool,
    opts: &SpawnOptions,
    pid: u32,
    signal: i32,
) -> Result<(), String> {
    if pid <= 1 {
        return Err("禁止终止系统 PID 1 关键进程".to_string());
    }

    let sig = if signal == 9 { 9 } else { 15 };

    if opts.is_local {
        let status = std::process::Command::new("kill")
            .args([format!("-{}", sig), pid.to_string()])
            .status()
            .map_err(|e| format!("执行 kill 失败: {}", e))?;

        if status.success() {
            Ok(())
        } else {
            Err(format!("终止进程 PID {} 失败 (权限不足或进程已不存在)", pid))
        }
    } else {
        let sess_arc = pool.get_or_connect(opts)?;
        let sess = sess_arc.lock().map_err(|e| e.to_string())?;
        let mut channel = match sess.channel_session() {
            Ok(c) => c,
            Err(e) => {
                drop(sess);
                pool.invalidate(&opts.session_id);
                return Err(format!("无法创建 SSH 通道: {}", e));
            }
        };

        let cmd = format!("kill -{} {} 2>&1", sig, pid);
        if let Err(e) = channel.exec(&cmd) {
            drop(channel);
            drop(sess);
            pool.invalidate(&opts.session_id);
            return Err(format!("远程 kill 失败: {}", e));
        }

        let mut out = String::new();
        channel.read_to_string(&mut out).ok();
        channel.wait_close().ok();

        if let Ok(exit_code) = channel.exit_status() {
            if exit_code == 0 {
                return Ok(());
            }
        }

        if out.trim().is_empty() {
            Ok(())
        } else {
            Err(out.trim().to_string())
        }
    }
}

pub fn get_disks(pool: &SftpPool, opts: &SpawnOptions) -> Result<Vec<DiskPartition>, String> {
    let output = if opts.is_local {
        let res = std::process::Command::new("df")
            .args(["-h", "-P"])
            .output()
            .map_err(|e| format!("无法执行本地 df: {}", e))?;
        String::from_utf8_lossy(&res.stdout).to_string()
    } else {
        let sess_arc = pool.get_or_connect(opts)?;
        let sess = sess_arc.lock().map_err(|e| e.to_string())?;
        let mut channel = match sess.channel_session() {
            Ok(c) => c,
            Err(e) => {
                drop(sess);
                pool.invalidate(&opts.session_id);
                return Err(format!("无法创建 SSH 通道: {}", e));
            }
        };

        if let Err(e) = channel.exec("df -h -P 2>/dev/null || df -h") {
            drop(channel);
            drop(sess);
            pool.invalidate(&opts.session_id);
            return Err(format!("无法执行远程 df 命令: {}", e));
        }

        let mut s = String::new();
        channel.read_to_string(&mut s).ok();
        channel.wait_close().ok();
        s
    };

    let mut partitions = Vec::new();
    for line in output.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 6 {
            let filesystem = parts[0].to_string();
            // Filter out virtual / loop / devfs pseudo filesystems
            if filesystem.starts_with("devfs")
                || filesystem.starts_with("map")
                || filesystem.starts_with("none")
                || filesystem.starts_with("udev")
            {
                continue;
            }

            let total = parts[1].to_string();
            let used = parts[2].to_string();
            let avail = parts[3].to_string();
            let pct_str = parts[4].trim_end_matches('%');
            let use_percent = pct_str.parse::<f64>().unwrap_or(0.0);
            let mount_point = parts[5..].join(" ");

            partitions.push(DiskPartition {
                filesystem,
                mount_point,
                total,
                used,
                avail,
                use_percent,
            });
        }
    }

    Ok(partitions)
}

pub fn get_server_users(
    pool: &SftpPool,
    opts: &SpawnOptions,
) -> Result<Vec<ServerUser>, String> {
    let raw_passwd = if opts.is_local {
        #[cfg(target_os = "macos")]
        {
            let res = std::process::Command::new("sh")
                .arg("-c")
                .arg("cat /etc/passwd 2>/dev/null; dscl . -list /Users UniqueID 2>/dev/null | awk '$2 >= 500 {print $1\":\"$2}'")
                .output()
                .map_err(|e| format!("读取本地用户失败: {}", e))?;
            String::from_utf8_lossy(&res.stdout).to_string()
        }
        #[cfg(not(target_os = "macos"))]
        {
            std::fs::read_to_string("/etc/passwd").unwrap_or_default()
        }
    } else {
        let sess_arc = pool.get_or_connect(opts)?;
        let sess = sess_arc.lock().map_err(|e| e.to_string())?;
        let mut channel = match sess.channel_session() {
            Ok(c) => c,
            Err(e) => {
                drop(sess);
                pool.invalidate(&opts.session_id);
                return Err(format!("无法创建 SSH 通道: {}", e));
            }
        };

        if let Err(e) = channel.exec("cat /etc/passwd 2>/dev/null || getent passwd") {
            drop(channel);
            drop(sess);
            pool.invalidate(&opts.session_id);
            return Err(format!("无法在远程执行获取用户命令: {}", e));
        }

        let mut s = String::new();
        channel.read_to_string(&mut s).ok();
        channel.wait_close().ok();
        s
    };

    let mut users: Vec<ServerUser> = Vec::new();
    let host_id = opts.host_id.as_deref().unwrap_or("");

    for line in raw_passwd.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let parts: Vec<&str> = line.split(':').collect();
        if parts.len() >= 2 {
            let username = parts[0].trim().to_string();
            if username.is_empty() || username.starts_with('_') && !opts.is_local {
                continue;
            }

            if users.iter().any(|u| u.username == username) {
                continue;
            }

            let uid = if parts.len() >= 3 {
                parts[2].trim().parse::<u32>().unwrap_or(9999)
            } else if parts.len() == 2 {
                parts[1].trim().parse::<u32>().unwrap_or(9999)
            } else {
                9999
            };

            let gid = if parts.len() >= 4 {
                parts[3].trim().parse::<u32>().unwrap_or(uid)
            } else {
                uid
            };

            let home = if parts.len() >= 6 {
                parts[5].trim().to_string()
            } else {
                format!("/home/{}", username)
            };

            let shell = if parts.len() >= 7 {
                parts[6].trim().to_string()
            } else {
                "/bin/bash".to_string()
            };

            let is_root = uid == 0 || username == "root";
            let is_non_login = shell.ends_with("/nologin")
                || shell.ends_with("/false")
                || shell.ends_with("/sync")
                || shell.ends_with("/halt")
                || shell.ends_with("/shutdown");
            let is_login_user = is_root || (!is_non_login && (uid >= 500 || shell.contains("sh")));

            let has_password = if !host_id.is_empty() {
                let user_key = format!("{}:user:{}", host_id, username);
                crate::vault::get_password(&user_key).is_some()
                    || (opts.username.as_deref() == Some(&username)
                        && crate::vault::get_password(host_id).is_some())
            } else {
                false
            };

            users.push(ServerUser {
                username,
                uid,
                gid,
                home,
                shell,
                is_root,
                is_login_user,
                has_password,
            });
        }
    }

    // Always ensure root is in the list
    if !users.iter().any(|u| u.username == "root") {
        let has_root_pwd = if !host_id.is_empty() {
            crate::vault::get_password(&format!("{}:user:root", host_id)).is_some()
                || (opts.username.as_deref() == Some("root") && crate::vault::get_password(host_id).is_some())
        } else {
            false
        };
        users.push(ServerUser {
            username: "root".to_string(),
            uid: 0,
            gid: 0,
            home: "/root".to_string(),
            shell: "/bin/bash".to_string(),
            is_root: true,
            is_login_user: true,
            has_password: has_root_pwd,
        });
    }

    // Sort: 1. root first, 2. login users, 3. other users
    users.sort_by(|a, b| {
        if a.is_root != b.is_root {
            return b.is_root.cmp(&a.is_root);
        }
        if a.is_login_user != b.is_login_user {
            return b.is_login_user.cmp(&a.is_login_user);
        }
        a.username.cmp(&b.username)
    });

    Ok(users)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortEntry {
    pub proto: String,
    pub local_ip: String,
    pub port: u32,
    pub state: String,
    pub pid: Option<u32>,
    pub program: String,
    pub user: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemdService {
    pub name: String,
    pub load: String,
    pub active: String,
    pub sub: String,
    pub description: String,
}

fn parse_lsof_ports(output: &str) -> Vec<PortEntry> {
    let mut ports = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for line in output.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 8 {
            continue;
        }

        let program = parts[0].to_string();
        let pid = parts[1].parse::<u32>().ok();
        let user = parts[2].to_string();

        let is_listen = line.contains("LISTEN");
        if !is_listen && !line.contains("UDP") {
            continue;
        }

        let proto = if line.contains("IPv6") {
            if line.contains("UDP") { "udp6" } else { "tcp6" }
        } else {
            if line.contains("UDP") { "udp" } else { "tcp" }
        };

        let target_part = if is_listen {
            if parts.len() >= 9 && parts.last().map(|s| s.contains("LISTEN")).unwrap_or(false) {
                parts[parts.len() - 2]
            } else {
                parts[parts.len() - 1]
            }
        } else {
            parts[parts.len() - 1]
        };

        if let Some(colon_idx) = target_part.rfind(':') {
            let ip_str = &target_part[..colon_idx];
            let port_str = &target_part[colon_idx + 1..];

            if let Ok(port) = port_str.parse::<u32>() {
                let local_ip = if ip_str == "*" || ip_str.is_empty() {
                    "0.0.0.0".to_string()
                } else {
                    ip_str.trim_matches(|c| c == '[' || c == ']').to_string()
                };

                let key = format!("{}:{}:{}", proto, port, local_ip);
                if !seen.contains(&key) {
                    seen.insert(key);
                    ports.push(PortEntry {
                        proto: proto.to_string(),
                        local_ip,
                        port,
                        state: if is_listen { "LISTEN".to_string() } else { "UNCONN".to_string() },
                        pid,
                        program,
                        user,
                    });
                }
            }
        }
    }

    ports.sort_by_key(|p| p.port);
    ports
}

fn parse_linux_ports(output: &str) -> Vec<PortEntry> {
    let mut ports = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("Netid") || line.starts_with("Proto") || line.starts_with("Active") {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        let is_ss = line.contains("users:(") || (!parts.is_empty() && (parts[0] == "tcp" || parts[0] == "udp") && parts.len() >= 5);

        if is_ss {
            let proto = parts[0].to_lowercase();
            let state = if parts.len() > 1 { parts[1].to_uppercase() } else { "LISTEN".to_string() };

            if !state.contains("LISTEN") && !state.contains("UNCONN") && proto.starts_with("tcp") {
                continue;
            }

            let local_addr = if parts.len() > 4 { parts[4] } else { "" };
            if let Some(colon_idx) = local_addr.rfind(':') {
                let ip_str = &local_addr[..colon_idx];
                let port_str = &local_addr[colon_idx + 1..];

                if let Ok(port) = port_str.parse::<u32>() {
                    let local_ip = if ip_str == "*" || ip_str.is_empty() {
                        "0.0.0.0".to_string()
                    } else {
                        ip_str.trim_matches(|c| c == '[' || c == ']').to_string()
                    };

                    let mut program = "-".to_string();
                    let mut pid: Option<u32> = None;

                    if let Some(u_idx) = line.find("users:((") {
                        let sub = &line[u_idx + 8..];
                        if let Some(end_quote) = sub.find('"') {
                            program = sub[..end_quote].to_string();
                        }
                        if let Some(pid_idx) = sub.find("pid=") {
                            let pid_sub = &sub[pid_idx + 4..];
                            let end_comma = pid_sub.find(|c| c == ',' || c == ')').unwrap_or(pid_sub.len());
                            pid = pid_sub[..end_comma].parse::<u32>().ok();
                        }
                    }

                    let key = format!("{}:{}:{}", proto, port, local_ip);
                    if !seen.contains(&key) {
                        seen.insert(key);
                        ports.push(PortEntry {
                            proto,
                            local_ip,
                            port,
                            state,
                            pid,
                            program,
                            user: "-".to_string(),
                        });
                    }
                }
            }
        } else if parts.len() >= 6 {
            let proto = parts[0].to_lowercase();
            if !proto.starts_with("tcp") && !proto.starts_with("udp") {
                continue;
            }

            let local_addr = parts[3];
            let state = if parts.len() > 5 { parts[5].to_uppercase() } else { "LISTEN".to_string() };

            if proto.starts_with("tcp") && !state.contains("LISTEN") {
                continue;
            }

            if let Some(colon_idx) = local_addr.rfind(':') {
                let ip_str = &local_addr[..colon_idx];
                let port_str = &local_addr[colon_idx + 1..];

                if let Ok(port) = port_str.parse::<u32>() {
                    let local_ip = if ip_str == "*" || ip_str.is_empty() || ip_str == "::" {
                        "0.0.0.0".to_string()
                    } else {
                        ip_str.trim_matches(|c| c == '[' || c == ']').to_string()
                    };

                    let last_part = parts.last().unwrap_or(&"-");
                    let mut program = "-".to_string();
                    let mut pid: Option<u32> = None;

                    if last_part.contains('/') {
                        let slash_parts: Vec<&str> = last_part.splitn(2, '/').collect();
                        pid = slash_parts[0].parse::<u32>().ok();
                        if slash_parts.len() > 1 {
                            program = slash_parts[1].to_string();
                        }
                    }

                    let key = format!("{}:{}:{}", proto, port, local_ip);
                    if !seen.contains(&key) {
                        seen.insert(key);
                        ports.push(PortEntry {
                            proto,
                            local_ip,
                            port,
                            state,
                            pid,
                            program,
                            user: "-".to_string(),
                        });
                    }
                }
            }
        }
    }

    ports.sort_by_key(|p| p.port);
    ports
}

pub fn get_ports(pool: &SftpPool, opts: &SpawnOptions) -> Result<Vec<PortEntry>, String> {
    if opts.is_local {
        #[cfg(target_os = "macos")]
        {
            let res = std::process::Command::new("lsof")
                .args(["-nP", "-iTCP", "-sTCP:LISTEN"])
                .output()
                .map_err(|e| format!("执行 lsof 失败: {}", e))?;
            let output = String::from_utf8_lossy(&res.stdout).to_string();
            return Ok(parse_lsof_ports(&output));
        }
        #[cfg(not(target_os = "macos"))]
        {
            let res = std::process::Command::new("sh")
                .arg("-c")
                .arg("ss -tulnp 2>/dev/null || netstat -tulnp 2>/dev/null || lsof -nP -iTCP -sTCP:LISTEN")
                .output()
                .map_err(|e| format!("执行本地端口命令失败: {}", e))?;
            let output = String::from_utf8_lossy(&res.stdout).to_string();
            return Ok(parse_linux_ports(&output));
        }
    } else {
        let sess_arc = pool.get_or_connect(opts)?;
        let sess = sess_arc.lock().map_err(|e| e.to_string())?;
        let mut channel = match sess.channel_session() {
            Ok(c) => c,
            Err(e) => {
                drop(sess);
                pool.invalidate(&opts.session_id);
                return Err(format!("无法创建 SSH 通道: {}", e));
            }
        };

        let cmd = "export PATH=$PATH:/usr/sbin:/sbin; ss -tulnp 2>/dev/null || netstat -tulnp 2>/dev/null || lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null";
        if let Err(e) = channel.exec(cmd) {
            drop(channel);
            drop(sess);
            pool.invalidate(&opts.session_id);
            return Err(format!("无法在远程执行端口查询命令: {}", e));
        }

        let mut output = String::new();
        channel.read_to_string(&mut output).ok();
        channel.wait_close().ok();

        if output.contains("Netid") || output.contains("Proto") {
            Ok(parse_linux_ports(&output))
        } else {
            Ok(parse_lsof_ports(&output))
        }
    }
}

pub fn get_systemd_services(pool: &SftpPool, opts: &SpawnOptions) -> Result<Vec<SystemdService>, String> {
    if opts.is_local {
        return Err("当前处于本地 macOS 环境，Systemd 服务管理仅在 Linux 远程服务器可用".to_string());
    }

    let sess_arc = pool.get_or_connect(opts)?;
    let sess = sess_arc.lock().map_err(|e| e.to_string())?;
    let mut channel = match sess.channel_session() {
        Ok(c) => c,
        Err(e) => {
            drop(sess);
            pool.invalidate(&opts.session_id);
            return Err(format!("无法创建 SSH 通道: {}", e));
        }
    };

    let cmd = "export PATH=$PATH:/usr/sbin:/sbin; systemctl list-units --type=service --all --no-legend --no-pager 2>/dev/null";
    if let Err(e) = channel.exec(cmd) {
        drop(channel);
        drop(sess);
        pool.invalidate(&opts.session_id);
        return Err(format!("无法执行 systemctl 命令: {}", e));
    }

    let mut output = String::new();
    channel.read_to_string(&mut output).ok();
    channel.wait_close().ok();

    let mut services = Vec::new();
    for line in output.lines() {
        let clean_line = line.trim().trim_start_matches('●').trim();
        if clean_line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = clean_line.split_whitespace().collect();
        if parts.len() >= 4 {
            let name = parts[0].to_string();
            if !name.ends_with(".service") {
                continue;
            }
            let load = parts[1].to_string();
            let active = parts[2].to_string();
            let sub = parts[3].to_string();
            let description = if parts.len() > 4 {
                parts[4..].join(" ")
            } else {
                String::new()
            };

            services.push(SystemdService {
                name,
                load,
                active,
                sub,
                description,
            });
        }
    }

    Ok(services)
}

pub fn control_systemd_service(
    pool: &SftpPool,
    opts: &SpawnOptions,
    name: &str,
    action: &str,
) -> Result<String, String> {
    if opts.is_local {
        return Err("Systemd 操作仅在 Linux 远程环境有效".to_string());
    }

    let valid_actions = ["start", "stop", "restart", "reload", "enable", "disable"];
    if !valid_actions.contains(&action) {
        return Err(format!("非法服务操作指令: {}", action));
    }

    let clean_name = name.trim().trim_end_matches(';').trim();
    if clean_name.is_empty() || clean_name.contains(' ') || clean_name.contains('&') || clean_name.contains('|') {
        return Err("非法服务名称".to_string());
    }

    let sess_arc = pool.get_or_connect(opts)?;
    let sess = sess_arc.lock().map_err(|e| e.to_string())?;
    let mut channel = match sess.channel_session() {
        Ok(c) => c,
        Err(e) => {
            drop(sess);
            pool.invalidate(&opts.session_id);
            return Err(format!("无法创建 SSH 通道: {}", e));
        }
    };

    let cmd = format!(
        "export PATH=$PATH:/usr/sbin:/sbin; systemctl {} {} 2>&1 || sudo -n systemctl {} {} 2>&1",
        action, clean_name, action, clean_name
    );

    if let Err(e) = channel.exec(&cmd) {
        drop(channel);
        drop(sess);
        pool.invalidate(&opts.session_id);
        return Err(format!("无法执行 systemctl 命令: {}", e));
    }

    let mut output = String::new();
    channel.read_to_string(&mut output).ok();
    channel.wait_close().ok();

    Ok(output.trim().to_string())
}

pub fn get_systemd_service_status(
    pool: &SftpPool,
    opts: &SpawnOptions,
    name: &str,
) -> Result<String, String> {
    if opts.is_local {
        return Err("Systemd 操作仅在 Linux 远程环境有效".to_string());
    }

    let clean_name = name.trim();
    let sess_arc = pool.get_or_connect(opts)?;
    let sess = sess_arc.lock().map_err(|e| e.to_string())?;
    let mut channel = match sess.channel_session() {
        Ok(c) => c,
        Err(e) => {
            drop(sess);
            pool.invalidate(&opts.session_id);
            return Err(format!("无法创建 SSH 通道: {}", e));
        }
    };

    let cmd = format!(
        "export PATH=$PATH:/usr/sbin:/sbin; systemctl status {} -n 50 --no-pager 2>&1",
        clean_name
    );

    if let Err(e) = channel.exec(&cmd) {
        drop(channel);
        drop(sess);
        pool.invalidate(&opts.session_id);
        return Err(format!("无法执行 systemctl status 命令: {}", e));
    }

    let mut output = String::new();
    channel.read_to_string(&mut output).ok();
    channel.wait_close().ok();

    Ok(output)
}
