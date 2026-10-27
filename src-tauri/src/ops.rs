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
