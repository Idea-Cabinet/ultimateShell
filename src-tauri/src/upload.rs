use crate::pty::SpawnOptions;
use crate::sftp::SftpPool;
use crate::transfer::TransferProgressPayload;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

struct FileItem {
    source: PathBuf,
    target: PathBuf,
}
struct Plan {
    directories: Vec<PathBuf>,
    files: Vec<FileItem>,
    total: u64,
}

fn cancelled(flag: &AtomicBool) -> Result<(), String> {
    if flag.load(Ordering::Relaxed) {
        Err("传输已取消".into())
    } else {
        Ok(())
    }
}

fn local_error(action: &str, path: &Path, error: std::io::Error) -> String {
    let help = if error.kind() == std::io::ErrorKind::PermissionDenied
        || error.raw_os_error() == Some(1)
    {
        "请检查本机文件权限及 macOS 文件访问授权。终端中的 sudo 不会提升本应用的文件权限。"
    } else if error.raw_os_error() == Some(30) {
        "目标位于只读文件系统，请选择可写目录。"
    } else {
        ""
    };
    format!("{action}「{}」失败：{error}。{help}", path.display())
}

fn remote_error(action: &str, path: &Path, account: &str, error: ssh2::Error) -> String {
    let help = if error.code() == ssh2::ErrorCode::SFTP(3) {
        "该账号没有写入权限。终端中的 sudo/su 不会改变 SFTP 身份，请选择该账号可写的目录，或使用有权限的 SSH 账号连接。"
    } else {
        ""
    };
    format!(
        "{action}「{}」失败（SFTP 账号：{account}）：{error}。{help}",
        path.display()
    )
}

fn expand_local(raw: &str) -> Result<PathBuf, String> {
    if raw.is_empty() {
        return Err("本地路径为空".into());
    }
    if raw == "~" || raw.starts_with("~/") {
        let home = std::env::var_os("HOME").ok_or("无法确定本机主目录")?;
        Ok(PathBuf::from(home).join(raw.strip_prefix("~/").unwrap_or("")))
    } else {
        Ok(PathBuf::from(raw))
    }
}

fn destination(pool: &SftpPool, opts: &SpawnOptions, raw: &str) -> Result<PathBuf, String> {
    if raw.is_empty() {
        return Err("上传目标为空".into());
    }
    if opts.is_local {
        return expand_local(raw);
    }
    if raw == "~" || raw.starts_with("~/") || raw == "." {
        let session = pool.get_or_connect(opts)?;
        let session = session.lock().map_err(|e| e.to_string())?;
        let sftp = session
            .sftp()
            .map_err(|e| format!("查询文件连接主目录失败：{e}"))?;
        let home = sftp
            .realpath(Path::new("."))
            .map_err(|e| format!("查询文件连接主目录失败：{e}"))?;
        Ok(home.join(raw.strip_prefix("~/").unwrap_or("")))
    } else if Path::new(raw).is_absolute() {
        Ok(PathBuf::from(raw))
    } else {
        Err("上传目标必须是明确的绝对目录或登录账号的主目录，已停止上传。".into())
    }
}

// Resolve existing ancestors too, so symlinked destination parents cannot bypass containment checks.
fn canonical_destination(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("本地上传目标必须是绝对路径".into());
    }
    let mut ancestor = path;
    let mut suffix = Vec::new();
    while !ancestor.exists() {
        suffix.push(
            ancestor
                .file_name()
                .ok_or("无法解析上传目标")?
                .to_os_string(),
        );
        ancestor = ancestor.parent().ok_or("无法解析上传目标")?;
    }
    let mut resolved =
        fs::canonicalize(ancestor).map_err(|e| local_error("解析本地目标", ancestor, e))?;
    for item in suffix.into_iter().rev() {
        resolved.push(item);
    }
    Ok(resolved)
}

fn plan(source: &Path, target: &Path, local: bool, flag: &AtomicBool) -> Result<Plan, String> {
    let meta =
        fs::symlink_metadata(source).map_err(|e| local_error("读取本地源文件", source, e))?;
    // Reject links rather than following directory cycles or silently uploading outside the selected tree.
    if meta.file_type().is_symlink() {
        return Err(format!(
            "上传包含符号链接「{}」，请直接选择实际文件或目录。",
            source.display()
        ));
    }
    if !meta.is_file() && !meta.is_dir() {
        return Err(format!("不支持上传此文件类型：{}", source.display()));
    }
    if local {
        let original =
            fs::canonicalize(source).map_err(|e| local_error("解析本地源文件", source, e))?;
        let dest = canonical_destination(target)?;
        if original == dest {
            return Ok(Plan {
                directories: vec![],
                files: vec![],
                total: 0,
            });
        }
        #[cfg(unix)]
        if meta.is_file() {
            use std::os::unix::fs::MetadataExt;
            if fs::metadata(target)
                .map(|m| m.dev() == meta.dev() && m.ino() == meta.ino())
                .unwrap_or(false)
            {
                return Ok(Plan {
                    directories: vec![],
                    files: vec![],
                    total: 0,
                });
            }
        }
        if meta.is_dir() && dest.starts_with(original) {
            return Err("不能将文件夹上传到它自身的子目录中。".into());
        }
    }
    let mut result = Plan {
        directories: vec![],
        files: vec![],
        total: 0,
    };
    fn walk(
        source: &Path,
        target: &Path,
        flag: &AtomicBool,
        result: &mut Plan,
    ) -> Result<(), String> {
        cancelled(flag)?;
        let meta =
            fs::symlink_metadata(source).map_err(|e| local_error("读取本地源文件", source, e))?;
        if meta.file_type().is_symlink() {
            return Err(format!("上传目录包含符号链接：{}", source.display()));
        }
        if meta.is_dir() {
            result.directories.push(target.to_path_buf());
            let entries =
                fs::read_dir(source).map_err(|e| local_error("读取本地目录", source, e))?;
            for entry in entries {
                let entry = entry.map_err(|e| local_error("读取目录项", source, e))?;
                walk(&entry.path(), &target.join(entry.file_name()), flag, result)?;
            }
        } else if meta.is_file() {
            result.total = result
                .total
                .checked_add(meta.len())
                .ok_or("上传大小超出支持范围")?;
            result.files.push(FileItem {
                source: source.to_path_buf(),
                target: target.to_path_buf(),
            });
        } else {
            return Err(format!("不支持上传此文件类型：{}", source.display()));
        }
        Ok(())
    }
    walk(source, target, flag, &mut result)?;
    Ok(result)
}

fn copy_stream(
    reader: &mut impl Read,
    writer: &mut impl Write,
    flag: &AtomicBool,
    transferred: &mut u64,
    progress: &mut impl FnMut(u64),
) -> Result<(), std::io::Error> {
    let mut buffer = [0u8; 64 * 1024];
    loop {
        if flag.load(Ordering::Relaxed) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "传输已取消",
            ));
        }
        let bytes = reader.read(&mut buffer)?;
        if bytes == 0 {
            break;
        }
        writer.write_all(&buffer[..bytes])?;
        *transferred += bytes as u64;
        progress(*transferred);
    }
    writer.flush()
}

pub fn upload(
    app: &AppHandle,
    pool: &SftpPool,
    opts: &SpawnOptions,
    local_path: &str,
    target_path: &str,
    task_id: &str,
    flag: &AtomicBool,
) -> Result<(), String> {
    let source = expand_local(local_path)?;
    let target = destination(pool, opts, target_path)?;
    let plan = plan(&source, &target, opts.is_local, flag)?;
    cancelled(flag)?;
    let mut transferred = 0;
    let mut last = Instant::now();
    let mut last_bytes = 0;
    let mut progress = |bytes: u64| {
        let elapsed = last.elapsed();
        if elapsed.as_millis() >= 120 {
            let speed = ((bytes - last_bytes) as f64 / elapsed.as_secs_f64()) as u64;
            last = Instant::now();
            last_bytes = bytes;
            let _ = app.emit(
                "file-transfer-progress",
                TransferProgressPayload {
                    task_id: task_id.into(),
                    transferred: bytes,
                    total: plan.total,
                    speed,
                },
            );
        }
    };
    if opts.is_local {
        for dir in &plan.directories {
            cancelled(flag)?;
            fs::create_dir_all(dir).map_err(|e| local_error("创建本地目标目录", dir, e))?;
        }
        for file in &plan.files {
            cancelled(flag)?;
            let mut reader = fs::File::open(&file.source)
                .map_err(|e| local_error("打开本地源文件", &file.source, e))?;
            let mut writer = fs::File::create(&file.target)
                .map_err(|e| local_error("打开本地目标文件", &file.target, e))?;
            copy_stream(
                &mut reader,
                &mut writer,
                flag,
                &mut transferred,
                &mut progress,
            )
            .map_err(|e| local_error("复制本地文件", &file.target, e))?;
        }
    } else {
        let account = opts.username.as_deref().unwrap_or("root");
        let session = pool.get_or_connect(opts)?;
        let session = session.lock().map_err(|e| e.to_string())?;
        let sftp = session
            .sftp()
            .map_err(|e| remote_error("启动 SFTP", &target, account, e))?;
        // A permission error is not a broken connection: never invalidate a healthy session for EACCES.
        for dir in &plan.directories {
            cancelled(flag)?;
            match sftp.stat(dir) {
                Ok(meta) if meta.is_dir() => {}
                Ok(_) => return Err(format!("目标已存在且不是目录：{}", dir.display())),
                Err(e) if e.code() == ssh2::ErrorCode::SFTP(2) => {
                    sftp.mkdir(dir, 0o755)
                        .map_err(|e| remote_error("创建远程目录", dir, account, e))?;
                }
                Err(e) => return Err(remote_error("检查远程目录", dir, account, e)),
            }
        }
        for file in &plan.files {
            cancelled(flag)?;
            let mut reader = fs::File::open(&file.source)
                .map_err(|e| local_error("打开本地源文件", &file.source, e))?;
            let mut writer = sftp
                .create(&file.target)
                .map_err(|e| remote_error("创建远程文件", &file.target, account, e))?;
            copy_stream(&mut reader, &mut writer, flag, &mut transferred, &mut progress)
                .map_err(|e| format!("上传「{}」失败（SFTP 账号：{account}）：{e}。终端中的 sudo/su 不会改变文件连接权限。", file.target.display()))?;
            writer
                .close()
                .map_err(|e| remote_error("完成远程文件写入", &file.target, account, e))?;
        }
    }
    cancelled(flag)?;
    let _ = app.emit(
        "file-transfer-progress",
        TransferProgressPayload {
            task_id: task_id.into(),
            transferred,
            total: plan.total,
            speed: 0,
        },
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> PathBuf {
        let path = std::env::temp_dir().join(format!("ultimate-upload-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }
    #[test]
    fn tree_plan_handles_empty_folders_and_sums_all_files() {
        let dir = fixture();
        let source = dir.join("source");
        fs::create_dir_all(source.join("empty")).unwrap();
        fs::write(source.join("a"), b"hello").unwrap();
        fs::write(source.join("empty/b"), b"world!").unwrap();
        let result = plan(
            &source,
            &dir.join("destination"),
            true,
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(
            (result.total, result.files.len(), result.directories.len()),
            (11, 2, 2)
        );
        assert!(
            plan(
                &source,
                &source.join("child"),
                true,
                &AtomicBool::new(false)
            )
            .is_err()
        );
        assert!(
            plan(&source, &source, true, &AtomicBool::new(false))
                .unwrap()
                .files
                .is_empty()
        );
        assert!(plan(&source, &dir.join("other"), true, &AtomicBool::new(true)).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn missing_sources_and_symlink_cycles_are_errors() {
        let dir = fixture();
        assert!(
            plan(
                &dir.join("missing"),
                &dir.join("out"),
                true,
                &AtomicBool::new(false)
            )
            .is_err()
        );
        #[cfg(unix)]
        {
            fs::create_dir(dir.join("source")).unwrap();
            std::os::unix::fs::symlink(dir.join("source"), dir.join("source/loop")).unwrap();
            assert!(
                plan(
                    &dir.join("source"),
                    &dir.join("out"),
                    true,
                    &AtomicBool::new(false)
                )
                .is_err()
            );
            fs::write(dir.join("file"), b"unchanged").unwrap();
            fs::hard_link(dir.join("file"), dir.join("alias")).unwrap();
            assert!(
                plan(
                    &dir.join("file"),
                    &dir.join("alias"),
                    true,
                    &AtomicBool::new(false)
                )
                .unwrap()
                .files
                .is_empty()
            );
        }
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn copy_checks_flush_and_cancellation() {
        struct BadFlush;
        impl Write for BadFlush {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Err(std::io::Error::other("disk full"))
            }
        }
        let mut bytes = 0;
        assert!(
            copy_stream(
                &mut &b"data"[..],
                &mut BadFlush,
                &AtomicBool::new(false),
                &mut bytes,
                &mut |_| {}
            )
            .is_err()
        );
        let mut writer = Vec::new();
        assert!(
            copy_stream(
                &mut &b"data"[..],
                &mut writer,
                &AtomicBool::new(true),
                &mut bytes,
                &mut |_| {}
            )
            .is_err()
        );
        assert!(writer.is_empty());
    }
}
