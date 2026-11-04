//! Bounded, concurrent stream collection; never interpret a decode error as execution failure.
use std::io::{ErrorKind, Read};
use std::time::{Duration, Instant};

pub const MAX_COMMAND: usize = 32 * 1024;
pub const MAX_OUTPUT: usize = 1024 * 1024;
pub const MAX_BODY: u64 = 1024 * 1024;

pub fn validate_command(command: &str) -> Result<(), String> {
    if command.is_empty() || command.as_bytes().contains(&0) {
        return Err("命令为空或包含 NUL（未发送）".into());
    }
    if command.len() > MAX_COMMAND {
        return Err(format!(
            "命令 {} 字节超过 {} 字节限制（未发送）；文件使用 /api/uploads，长任务使用 /api/jobs",
            command.len(),
            MAX_COMMAND
        ));
    }
    Ok(())
}

#[derive(Default)]
pub struct Capture {
    pub out: Vec<u8>,
    pub err: Vec<u8>,
    pub truncated: bool,
}
impl Capture {
    pub fn push(&mut self, stderr: bool, data: &[u8]) {
        // Reserve half the budget for each stream; stderr cannot erase the useful stdout summary.
        let retained = if stderr {
            self.err.len()
        } else {
            self.out.len()
        };
        let available = (MAX_OUTPUT / 2).saturating_sub(retained);
        self.truncated |= data.len() > available;
        let target = if stderr { &mut self.err } else { &mut self.out };
        target.extend_from_slice(&data[..data.len().min(available)]);
    }
    pub fn text(&self) -> (String, String) {
        let mut out = String::from_utf8_lossy(&self.out).into_owned();
        let mut err = String::from_utf8_lossy(&self.err).into_owned();
        if std::str::from_utf8(&self.out).is_err() || std::str::from_utf8(&self.err).is_err() {
            err.push_str("\n[输出含非 UTF-8 字节，已替换；不影响退出码]");
        }
        if self.truncated {
            out.push_str("\n[输出达到 1 MiB，后续数据已排空但未保留]");
        }
        (out, err)
    }
    fn failure(&self, message: &str) -> String {
        let (out, err) = self.text();
        // Keep bounded progress when a channel fails, without replaying the command.
        format!(
            "{message}；执行结果未知，不会自动重试\n已收标准输出：{}\n已收标准错误：{}",
            out, err
        )
    }
}

pub fn collect(
    channel: &mut ssh2::Channel,
    session: &ssh2::Session,
) -> Result<(i32, String, String), String> {
    // Session belongs to a locked lease. Restore blocking mode on every exit.
    session.set_blocking(false);
    let result = collect_nonblocking(channel);
    session.set_blocking(true);
    result
}
fn collect_nonblocking(channel: &mut ssh2::Channel) -> Result<(i32, String, String), String> {
    let start = Instant::now();
    let mut capture = Capture::default();
    let mut buf = [0; 16384];
    loop {
        let mut progress = false;
        for stderr in [false, true] {
            let read = if stderr {
                channel.stderr().read(&mut buf)
            } else {
                channel.read(&mut buf)
            };
            match read {
                Ok(n) if n > 0 => {
                    capture.push(stderr, &buf[..n]);
                    progress = true;
                }
                Ok(_) => {}
                Err(e) if e.kind() == ErrorKind::WouldBlock => {}
                Err(e) => return Err(capture.failure(&format!("读取 SSH 输出失败：{e}"))),
            }
        }
        if channel.eof() && !progress {
            break;
        }
        if start.elapsed() > Duration::from_secs(120) {
            return Err(capture.failure("同步命令超过 120 秒；长任务请使用 /api/jobs"));
        }
        if !progress {
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    loop {
        match channel.wait_close() {
            Ok(()) => break,
            Err(e)
                if e.code() == ssh2::ErrorCode::Session(-37)
                    && start.elapsed() < Duration::from_secs(120) =>
            {
                std::thread::sleep(Duration::from_millis(10))
            }
            Err(e) => return Err(capture.failure(&format!("等待 SSH 退出状态失败：{e}"))),
        }
    }
    let signal = channel
        .exit_signal()
        .map_err(|e| capture.failure(&format!("读取退出信号失败：{e}")))?;
    if let Some(signal) = signal.exit_signal {
        return Err(format!(
            "远程命令被信号 {signal} 终止（不是成功）；{}",
            capture.failure("信号终止")
        ));
    }
    let code = channel
        .exit_status()
        .map_err(|e| capture.failure(&format!("读取退出码失败：{e}")))?;
    let (out, err) = capture.text();
    Ok((code, out, err))
}

pub fn local(command: &str) -> Result<(i32, String, String), String> {
    use std::{
        os::{fd::AsRawFd, unix::process::CommandExt},
        process::{Command, Stdio},
    };
    let mut child = Command::new("sh")
        .arg("-c")
        .arg(command)
        .process_group(0)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut out = child.stdout.take().unwrap();
    let mut err = child.stderr.take().unwrap();
    for fd in [out.as_raw_fd(), err.as_raw_fd()] {
        // Only these owned pipe descriptors are changed; no process-global settings.
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
            let error = std::io::Error::last_os_error();
            let _ = child.kill();
            let _ = child.wait();
            return Err(error.to_string());
        }
    }
    let start = Instant::now();
    let mut ended = None;
    let mut status = None;
    let mut done = [false; 2];
    let mut capture = Capture::default();
    let mut buf = [0; 16384];
    loop {
        let mut progress = false;
        for (i, reader) in [&mut out as &mut dyn Read, &mut err as &mut dyn Read]
            .into_iter()
            .enumerate()
        {
            if done[i] {
                continue;
            }
            match reader.read(&mut buf) {
                Ok(0) => done[i] = true,
                Ok(n) => {
                    capture.push(i == 1, &buf[..n]);
                    progress = true
                }
                Err(e) if e.kind() == ErrorKind::WouldBlock => {}
                Err(e) => {
                    unsafe {
                        libc::kill(-(child.id() as i32), libc::SIGKILL);
                    }
                    let _ = child.wait();
                    return Err(capture.failure(&e.to_string()));
                }
            }
        }
        if status.is_none() {
            status = child.try_wait().map_err(|e| e.to_string())?;
            if status.is_some() {
                ended = Some(Instant::now())
            }
        }
        if let Some(status) = status {
            if done.iter().all(|d| *d)
                || ended.is_some_and(|t| t.elapsed() > Duration::from_secs(1))
            {
                let (out, mut err) = capture.text();
                if !done.iter().all(|d| *d) {
                    err.push_str("\n[子进程保留了输出管道；已停止等待]");
                }
                return Ok((status.code().unwrap_or(-1), out, err));
            }
        }
        if start.elapsed() > Duration::from_secs(120) {
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            let _ = child.wait();
            return Err(capture.failure("本地命令超过120秒，已向进程组发送终止信号"));
        }
        if !progress {
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn command_byte_limit() {
        assert!(validate_command(&"a".repeat(MAX_COMMAND)).is_ok());
        assert!(validate_command(&"中".repeat(MAX_COMMAND / 3 + 1)).is_err());
        assert!(validate_command("a\0b").is_err());
    }
    #[test]
    fn bounded_and_non_utf8() {
        let mut c = Capture::default();
        c.push(false, &vec![b'a'; MAX_OUTPUT + 1]);
        c.push(true, b"\xff");
        assert_eq!(c.out.len(), MAX_OUTPUT / 2);
        assert_eq!(c.err.len(), 1);
        assert!(c.truncated);
        let mut c = Capture::default();
        c.push(true, b"\xff");
        assert!(c.text().1.contains("不影响退出码"));
    }
    #[test]
    fn local_drains_both_streams() {
        let (code, out, err) = local(
            "i=0; while [ $i -lt 2000 ]; do echo out; echo err >&2; i=$((i+1)); done; exit 7",
        )
        .unwrap();
        assert_eq!(code, 7);
        assert!(out.contains("out"));
        assert!(err.contains("err"));
    }
}
