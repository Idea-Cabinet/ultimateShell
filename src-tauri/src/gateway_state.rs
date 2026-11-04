//! Fail-closed durable records and per-resource locks shared by all gateway processes.
use serde::de::DeserializeOwned;
use std::os::{fd::AsRawFd, unix::fs::OpenOptionsExt};
use std::{
    fs::{self, File, OpenOptions},
    io::Read,
    path::Path,
};

pub struct ResourceLock(File);
impl Drop for ResourceLock {
    fn drop(&mut self) {
        unsafe {
            libc::flock(self.0.as_raw_fd(), libc::LOCK_UN);
        }
    }
}
pub fn lock_at(directory: &Path, name: &str) -> Result<ResourceLock, String> {
    if !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err("无效锁名称".into());
    }
    crate::gateway_audit::private_dir(directory)?;
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(directory.join(format!("{name}.lock")))
        .map_err(|e| e.to_string())?;
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        return Err("busy: 该资源有正在处理的请求；稍后查询原ID，不要重建任务".into());
    }
    Ok(ResourceLock(file))
}
pub fn lock(namespace: &str, id: &str) -> Result<ResourceLock, String> {
    lock_at(
        &crate::agent_gateway::gateway_state_dir()?.join("locks"),
        &format!("{namespace}-{id}"),
    )
}
pub fn read<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    let file = match OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
    {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("状态记录不可读，禁止重新执行：{e}")),
    };
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("状态记录不是普通文件，禁止重新执行".into());
    }
    let mut bytes = Vec::new();
    file.take(65537)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 65536 {
        return Err("状态记录过大，禁止重新执行".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|e| format!("状态记录损坏，禁止覆盖或重新执行：{e}"))
}
pub fn sync_parent(path: &Path) -> Result<(), String> {
    File::open(path.parent().ok_or("无效状态路径")?)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())
}
pub fn create_private(path: &Path) -> Result<File, String> {
    OpenOptions::new()
        .create_new(true)
        .write(true)
        .read(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|e| format!("状态/临时文件已存在或无法创建（不会覆盖）：{e}"))
}
pub fn new_private_dir(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::DirBuilderExt;
    fs::DirBuilder::new()
        .mode(0o700)
        .create(path)
        .map_err(|e| format!("任务目录已存在或无法创建（不会复用）：{e}"))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn locks_are_per_resource_and_exclusive() {
        let p = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let a = lock_at(&p, "a").unwrap();
        assert!(lock_at(&p, "a").is_err());
        assert!(lock_at(&p, "b").is_ok());
        drop(a);
        assert!(lock_at(&p, "a").is_ok());
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn corrupt_or_symlink_record_is_never_missing() {
        let p = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&p).unwrap();
        let f = p.join("state.json");
        assert!(read::<serde_json::Value>(&f).unwrap().is_none());
        fs::write(&f, b"broken").unwrap();
        assert!(read::<serde_json::Value>(&f).is_err());
        std::os::unix::fs::symlink(&f, p.join("link")).unwrap();
        assert!(read::<serde_json::Value>(&p.join("link")).is_err());
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn record_lock_is_shared_with_another_process() {
        let p = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let _lock = lock_at(&p, "resource").unwrap();
        let code = "import fcntl,sys; f=open(sys.argv[1],'r+');\ntry: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError: sys.exit(0)\nsys.exit(1)";
        assert!(
            std::process::Command::new("python3")
                .arg("-c")
                .arg(code)
                .arg(p.join("resource.lock"))
                .status()
                .unwrap()
                .success()
        );
        fs::remove_dir_all(p).unwrap();
    }
}
