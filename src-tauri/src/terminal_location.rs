/// Metadata belongs to one PTY, never to the last login of an account.
pub struct TtyTracker {
    prefix: String,
    pending: String,
}

pub fn remote_shell_command(token: &str) -> String {
    let script = format!(
        "printf '\\033]777;ultimateshell-tty-{token}='; tty | tr -d '\\r\\n'; printf '\\007'; exec \"${{SHELL:-/bin/sh}}\" -l"
    );
    format!("sh -c '{}'", script.replace('\'', "'\\''"))
}

pub fn valid_tty(value: &str) -> bool {
    value.starts_with("/dev/")
        && value.len() > 5
        && value.len() < 128
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"/_-".contains(&c))
}

pub fn cwd_command(tty: &str) -> Result<String, String> {
    if !valid_tty(tty) {
        return Err("终端标识无效".into());
    }
    let tty = tty.trim_start_matches("/dev/");
    Ok(format!(
        r#"PID=$(ps -t '{}' -o pid=,stat= 2>/dev/null | awk '$2 ~ /\+/ {{print $1; exit}}'); if [ -n "$PID" ]; then readlink "/proc/$PID/cwd" 2>/dev/null || lsof -a -d cwd -p "$PID" -Fn 2>/dev/null | sed -n 's/^n//p'; fi"#,
        tty
    ))
}

impl TtyTracker {
    pub fn new(token: &str) -> Self {
        Self {
            prefix: format!("\x1b]777;ultimateshell-tty-{token}="),
            pending: String::new(),
        }
    }
    pub fn observe(&mut self, chunk: &str) -> Option<String> {
        self.pending.push_str(chunk);
        if let Some(start) = self.pending.find(&self.prefix) {
            let value = &self.pending[start + self.prefix.len()..];
            if let Some(end) = value.find('\x07') {
                let tty = value[..end].trim().to_string();
                self.pending.clear();
                return valid_tty(&tty).then_some(tty);
            }
        }
        if self.pending.len() > 8192 {
            let mut offset = self.pending.len() - 4096;
            while !self.pending.is_char_boundary(offset) {
                offset += 1;
            }
            self.pending.drain(..offset);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn captures_split_marker_without_accepting_another_session() {
        let marker = "\x1b]777;ultimateshell-tty-token=/dev/pts/12\x07";
        for split in 0..=marker.len() {
            let mut tracker = TtyTracker::new("token");
            let first = tracker.observe(&marker[..split]);
            let second = tracker.observe(&marker[split..]);
            assert_eq!(first.or(second).as_deref(), Some("/dev/pts/12"));
        }
        let mut tracker = TtyTracker::new("token");
        assert!(
            tracker
                .observe("\x1b]777;ultimateshell-tty-other=/dev/pts/99\x07")
                .is_none()
        );
        assert!(
            tracker
                .observe("\x1b]777;ultimateshell-tty-token=/dev/pts/1;rm\x07")
                .is_none()
        );
        assert!(valid_tty("/dev/ttys002"));
    }
    #[test]
    fn login_command_emits_only_session_metadata_before_shell() {
        let cmd = remote_shell_command("abc");
        assert!(cmd.contains("ultimateshell-tty-abc="));
        assert!(cmd.contains("exec"));
        assert!(!cmd.contains('%')); // OpenSSH RemoteCommand expands percent tokens.
    }
    #[test]
    fn remote_command_runs_in_a_real_pty() {
        use portable_pty::{CommandBuilder, PtySize, native_pty_system};
        use std::io::Read;
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut command = CommandBuilder::new("/bin/sh");
        command.arg("-c");
        command.arg(remote_shell_command("test-token"));
        command.env("SHELL", "/usr/bin/true");
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut output = String::new();
        let _ = reader.read_to_string(&mut output);
        let status = child.wait().unwrap();
        assert!(status.success(), "remote startup failed: {output}");
        assert!(
            TtyTracker::new("test-token").observe(&output).is_some(),
            "missing TTY marker: {output}"
        );
    }
    #[test]
    fn cwd_query_selects_the_identified_foreground_terminal() {
        use portable_pty::{CommandBuilder, PtySize, native_pty_system};
        use std::io::Read;
        let dir = std::env::temp_dir().join(format!("ultimate-cwd-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut command = CommandBuilder::new("/bin/sh");
        command.arg("-c");
        command.arg("printf '\\033]777;ultimateshell-tty-cwd='; tty | tr -d '\\r\\n'; printf '\\007'; while :; do read line || exit; done");
        command.cwd(&dir);
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut bytes = Vec::new();
        loop {
            let mut byte = [0];
            reader.read_exact(&mut byte).unwrap();
            bytes.push(byte[0]);
            if byte[0] == 7 {
                break;
            }
        }
        let tty = TtyTracker::new("cwd")
            .observe(&String::from_utf8_lossy(&bytes))
            .unwrap();
        let output = std::process::Command::new("/bin/sh")
            .args(["-c", &cwd_command(&tty).unwrap()])
            .output()
            .unwrap();
        let local = crate::sftp::get_terminal_cwd(
            &crate::sftp::SftpPool::new(),
            &crate::pty::SpawnOptions {
                session_id: "fixture".into(),
                is_local: true,
                host_id: None,
                host_name: None,
                host: None,
                port: None,
                username: None,
                identity_file: None,
                proxy_type: None,
                jump_host_id: None,
                proxy_url: None,
                cols: None,
                rows: None,
            },
            child.process_id(),
            None,
        );
        child.kill().unwrap();
        let _ = child.wait();
        let actual = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let expected = std::fs::canonicalize(&dir)
            .unwrap()
            .to_string_lossy()
            .to_string();
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(local.unwrap(), expected);
        assert_eq!(
            actual,
            expected,
            "terminal location query failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
