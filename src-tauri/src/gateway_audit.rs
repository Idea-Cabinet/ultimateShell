use super::agent_gateway::{AuditLogEntry, redact_sensitive_output};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
    sync::Mutex,
};
static LOCK: Mutex<()> = Mutex::new(());
const LIMIT: u64 = 2 * 1024 * 1024;

pub fn private_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())
}
pub fn write_private(path: &Path, data: &[u8]) -> Result<(), String> {
    use std::os::unix::fs::OpenOptionsExt;
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        f.write_all(data).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&temp, path).map_err(|e| e.to_string())?;
        crate::gateway_state::sync_parent(path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}
pub fn command_summary(command: &str) -> String {
    // Arbitrary scripts and long/binary payloads are not useful audit text. Never store their body.
    let lower = command.to_lowercase();
    if command.len() > 1024
        || [
            "python",
            "node ",
            "bash ",
            "sh ",
            "powershell",
            "base64",
            "<<",
        ]
        .iter()
        .any(|p| lower.contains(p))
    {
        return format!(
            "[脚本/载荷已省略；{} bytes；SHA-256 {:x}]",
            command.len(),
            Sha256::digest(command.as_bytes())
        );
    }
    redact_sensitive_output(command)
        .chars()
        .take(1024)
        .collect()
}
pub fn sanitize(mut entry: AuditLogEntry) -> AuditLogEntry {
    entry.command = command_summary(&entry.command);
    entry.agent_name = redact_sensitive_output(&entry.agent_name)
        .chars()
        .take(80)
        .collect();
    entry.server_target = redact_sensitive_output(&entry.server_target)
        .chars()
        .take(256)
        .collect();
    entry.output_snippet = entry
        .output_snippet
        .map(|s| redact_sensitive_output(&s).chars().take(4096).collect());
    entry
}
pub fn append(path: &Path, entry: &AuditLogEntry) -> Result<(), String> {
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    private_dir(path.parent().ok_or("无效审计目录")?)?;
    let mut process_lock = None;
    for _ in 0..100 {
        match crate::gateway_state::lock_at(path.parent().unwrap(), "audit-writer") {
            Ok(lock) => {
                process_lock = Some(lock);
                break;
            }
            Err(e) if e.starts_with("busy:") => {
                std::thread::sleep(std::time::Duration::from_millis(2))
            }
            Err(e) => return Err(e),
        }
    }
    let _process_lock = process_lock.ok_or("审计写入锁超时")?;
    if fs::metadata(path)
        .map(|m| m.len() >= LIMIT)
        .unwrap_or(false)
    {
        let backup = path.with_extension("jsonl.1");
        if backup.exists() {
            fs::remove_file(&backup).map_err(|e| e.to_string())?;
        }
        fs::rename(path, backup).map_err(|e| e.to_string())?;
    }
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let mut f = OpenOptions::new()
        .create(true)
        .read(true)
        .append(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| e.to_string())?;
    f.set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|e| e.to_string())?;
    if f.metadata().map_err(|e| e.to_string())?.len() > 0 {
        f.seek(SeekFrom::End(-1)).map_err(|e| e.to_string())?;
        let mut byte = [0];
        f.read_exact(&mut byte).map_err(|e| e.to_string())?;
        if byte[0] != b'\n' {
            f.write_all(b"\n").map_err(|e| e.to_string())?;
        }
    }
    let mut bytes = serde_json::to_vec(entry).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    f.write_all(&bytes).map_err(|e| e.to_string())?;
    f.sync_data().map_err(|e| e.to_string())
}
pub fn load(path: &Path) -> Vec<AuditLogEntry> {
    let mut entries = Vec::new();
    for p in [path.with_extension("jsonl.1"), path.to_path_buf()] {
        if let Ok(file) = fs::File::open(p) {
            let mut body = Vec::new();
            let _ = file.take(LIMIT + 16384).read_to_end(&mut body);
            for line in body.split(|byte| *byte == b'\n') {
                if let Ok(entry) = serde_json::from_slice::<AuditLogEntry>(line) {
                    entries.push(sanitize(entry));
                }
            }
        }
    }
    entries.reverse();
    entries.truncate(300);
    entries
}
pub fn clear(path: &Path) -> Result<(), String> {
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    let _process =
        crate::gateway_state::lock_at(path.parent().ok_or("无效日志目录")?, "audit-writer")?;
    for p in [path.to_path_buf(), path.with_extension("jsonl.1")] {
        match fs::remove_file(p) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn payload_is_not_saved() {
        let s = "python3 -c 'secret-body'";
        assert!(!command_summary(s).contains("secret-body"));
        assert!(command_summary(s).contains("SHA-256"));
    }
    #[test]
    fn atomic_private_file() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        private_dir(&dir).unwrap();
        let p = dir.join("state.json");
        write_private(&p, b"first").unwrap();
        write_private(&p, b"second").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"second");
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&p).unwrap().permissions().mode() & 0o777,
            0o600
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
