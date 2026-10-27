/// Tracks only input entered at an SSH password prompt. Output is a stream:
/// prompts and rejection messages can span arbitrary PTY reads.
#[derive(Clone, Default)]
pub struct PasswordTracker {
    pub is_tracking: bool,
    pub current_input: String,
    pub tentative_password: Option<String>,
    pub initial_password: Option<String>,
    pub host_id: Option<String>,
    pub host_name: Option<String>,
    output: String,
    automatic_attempted: bool,
    authenticated: bool,
    success_marker: String,
    pending_output: String,
    login_verified: bool,
}

impl PasswordTracker {
    pub fn new(
        password: Option<String>,
        host_id: Option<String>,
        host_name: Option<String>,
    ) -> Self {
        Self {
            initial_password: password,
            host_id,
            host_name,
            success_marker: "\x1b]777;test-login\x07".into(),
            ..Self::default()
        }
    }

    pub fn set_success_marker(&mut self, marker: String) {
        self.success_marker = marker;
    }

    // The local SSH client emits this per-connection marker only after authentication.
    // Hold partial markers so no part of them is rendered by xterm.
    pub fn filter_output(&mut self, chunk: &str) -> String {
        if self.authenticated {
            return chunk.to_string();
        }
        self.pending_output.push_str(chunk);
        if let Some(pos) = self.pending_output.find(&self.success_marker) {
            self.pending_output
                .replace_range(pos..pos + self.success_marker.len(), "");
            self.login_verified = true;
            return std::mem::take(&mut self.pending_output);
        }
        let keep = (1..self.success_marker.len())
            .rev()
            .find(|&n| {
                self.success_marker.is_char_boundary(n)
                    && self.pending_output.ends_with(&self.success_marker[..n])
            })
            .unwrap_or(0);
        let release = self.pending_output.len() - keep;
        self.pending_output.drain(..release).collect()
    }

    pub fn observe_output(&mut self, chunk: &str) -> Option<String> {
        if self.authenticated {
            return None;
        }
        self.output.push_str(chunk);
        // Bound memory while retaining enough context for split prompts.
        if self.output.len() > 8192 {
            let mut start = self.output.len() - 4096;
            while !self.output.is_char_boundary(start) {
                start += 1;
            }
            self.output.drain(..start);
        }
        let lower = self.output.to_lowercase();
        let rejected = [
            "permission denied",
            "please try again",
            "authentication failed",
            "access denied",
        ]
        .iter()
        .any(|s| lower.contains(s));
        if rejected {
            self.is_tracking = false;
            self.current_input.clear();
            self.tentative_password = None;
        }
        let prompt = lower.trim_end();
        if prompt.ends_with("password:") || prompt.ends_with("密码:") || prompt.ends_with("密码：")
        {
            self.output.clear();
            self.current_input.clear();
            self.tentative_password = None;
            self.is_tracking = true;
            if !self.automatic_attempted {
                self.automatic_attempted = true;
                if let Some(password) = self.initial_password.clone() {
                    self.is_tracking = false;
                    return Some(password);
                }
            }
        } else if rejected {
            // Do not discard the start of a subsequent prompt in the same read.
            // Once a line break arrives, old rejection text is no longer needed.
            if let Some(pos) = self.output.rfind('\n') {
                self.output.drain(..=pos);
            }
        }
        None
    }

    pub fn login_succeeded(&mut self) -> bool {
        if self.authenticated || !self.login_verified {
            return false;
        }
        self.authenticated = true;
        self.is_tracking = false;
        self.current_input.clear();
        true
    }

    pub fn record_input(&mut self, data: &str) {
        if !self.is_tracking {
            return;
        }
        for c in data.chars() {
            match c {
                '\r' | '\n' => {
                    self.tentative_password = Some(std::mem::take(&mut self.current_input));
                    self.is_tracking = false;
                    self.output.clear();
                    // Never capture commands pasted after the password newline.
                    break;
                }
                '\x08' | '\x7f' => {
                    self.current_input.pop();
                }
                '\x03' => {
                    self.current_input.clear();
                    self.is_tracking = false;
                    break;
                }
                '\x15' => self.current_input.clear(),
                c if !c.is_control() => self.current_input.push(c),
                _ => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn split_prompt_and_rejection_allow_manual_retry() {
        let mut t = PasswordTracker::new(Some("old".into()), None, None);
        assert_eq!(t.observe_output("root@host's pass"), None);
        assert_eq!(t.observe_output("word: "), Some("old".into()));
        t.observe_output("Permission de");
        t.observe_output("nied, please try again.\r\nroot@host's pass");
        assert_eq!(t.observe_output("word: "), None);
        assert!(t.is_tracking);
        t.record_input("new\rwhoami\r");
        assert_eq!(t.tentative_password.as_deref(), Some("new"));
        t.filter_output("\x1b]777;test-login\x07");
        assert!(t.login_succeeded());
        t.observe_output("sudo password:");
        assert!(!t.is_tracking);
    }
    #[test]
    fn failed_manual_attempt_is_discarded() {
        let mut t = PasswordTracker::new(None, None, None);
        t.record_input("not a password\r");
        assert_eq!(t.tentative_password, None);
        t.observe_output("Password: ");
        t.record_input("wrong\r");
        t.observe_output("Permission denied, please try again.\r\nPassword: ");
        assert_eq!(t.tentative_password, None);
        t.record_input("typo\x15rightx\x7f\r");
        assert_eq!(t.tentative_password.as_deref(), Some("right"));
        t.filter_output("\x1b]777;test-login\x07");
        assert!(t.login_succeeded());
    }
    #[test]
    fn saved_login_stops_tracking_later_sudo_prompts() {
        let mut t = PasswordTracker::new(Some("saved".into()), None, None);
        assert_eq!(t.observe_output("Password: "), Some("saved".into()));
        t.filter_output("\x1b]777;test-login\x07");
        assert!(t.login_succeeded());
        assert_eq!(t.observe_output("[sudo] password: "), None);
        t.record_input("sudo-secret\r");
        assert_eq!(t.tentative_password, None);
    }

    #[test]
    fn login_requires_ssh_confirmation_and_filters_split_marker() {
        let mut t = PasswordTracker::new(None, None, None);
        t.observe_output("Password: ");
        t.record_input("correct\r");
        t.observe_output("Welcome to Linux");
        assert!(!t.login_succeeded());
        assert_eq!(t.filter_output("hello\x1b]777;test-"), "hello");
        assert!(!t.login_succeeded());
        assert_eq!(t.filter_output("login\x07shell> "), "shell> ");
        assert!(t.login_succeeded());
        assert!(!t.login_succeeded());
    }

    #[test]
    fn every_marker_split_is_hidden_and_confirms_login() {
        let marker = "\x1b]777;test-login\x07";
        for split in 0..=marker.len() {
            let mut t = PasswordTracker::new(None, None, None);
            let first = t.filter_output(&format!("before{}", &marker[..split]));
            let second = t.filter_output(&format!("{}after", &marker[split..]));
            assert_eq!(format!("{}{}", first, second), "beforeafter");
            assert!(t.login_succeeded());
        }
    }

    #[test]
    fn banner_does_not_end_password_entry() {
        let mut t = PasswordTracker::new(None, None, None);
        t.observe_output("Welcome to Linux\r\nPassword: ");
        assert!(!t.login_succeeded());
        assert!(t.is_tracking);
    }
}
