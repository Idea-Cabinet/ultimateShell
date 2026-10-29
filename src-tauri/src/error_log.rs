use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

static LOG_LOCK: Mutex<()> = Mutex::new(());
const MAX_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Serialize)]
pub struct ErrorEntry<'a> {
    pub operation: &'a str,
    pub session_id: &'a str,
    pub account: &'a str,
    pub source: &'a str,
    pub target: &'a str,
    pub error: &'a str,
}

pub fn path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_log_dir()
        .map(|p| p.join("file-errors.jsonl"))
        .map_err(|e| e.to_string())
}

pub fn record(app: &AppHandle, entry: ErrorEntry<'_>) {
    // Repeated polling failures should not flood the local log.
    static RECENT: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    let key = serde_json::to_string(&entry).unwrap_or_default();
    if let Ok(mut recent) = RECENT.get_or_init(Default::default).lock() {
        if recent
            .get(&key)
            .is_some_and(|last| last.elapsed() < Duration::from_secs(30))
        {
            return;
        }
        if recent.len() >= 256 {
            recent.clear();
        }
        recent.insert(key, Instant::now());
    }
    if let Err(error) = path(app).and_then(|p| append(&p, &entry)) {
        eprintln!("[file-error-log] 写入失败: {error}");
    }
}

fn append(path: &Path, entry: &ErrorEntry<'_>) -> Result<(), String> {
    let _lock = LOG_LOCK.lock().map_err(|e| e.to_string())?;
    let parent = path.parent().ok_or("无效的日志路径")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    if fs::metadata(path)
        .map(|m| m.len() >= MAX_BYTES)
        .unwrap_or(false)
    {
        let backup = path.with_extension("jsonl.1");
        match fs::remove_file(&backup) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
        fs::rename(path, backup).map_err(|e| e.to_string())?;
    }
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    // Only explicit diagnostic fields are recorded: never terminal output, passwords or keys.
    let mut value = serde_json::to_value(entry).map_err(|e| e.to_string())?;
    for field in value.as_object_mut().unwrap().values_mut() {
        if let Some(text) = field.as_str() {
            *field = serde_json::Value::String(text.chars().take(4096).collect());
        }
    }
    value["time"] = chrono::Utc::now().to_rfc3339().into();
    serde_json::to_writer(&mut file, &value).map_err(|e| e.to_string())?;
    file.write_all(b"\n").map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn errors_are_json_lines_and_rotate() {
        let dir = std::env::temp_dir().join(format!("ultimate-errors-{}", uuid::Uuid::new_v4()));
        let path = dir.join("file-errors.jsonl");
        let entry = ErrorEntry {
            operation: "upload",
            session_id: "test",
            account: "test",
            source: "a",
            target: "b",
            error: "denied\nnext line",
        };
        append(&path, &entry).unwrap();
        let contents = fs::read_to_string(&path).unwrap();
        assert_eq!(contents.lines().count(), 1);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&contents).unwrap()["error"],
            "denied\nnext line"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(MAX_BYTES)
            .unwrap();
        append(&path, &entry).unwrap();
        assert!(path.with_extension("jsonl.1").exists());
        assert_eq!(fs::read_to_string(&path).unwrap().lines().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }
}
