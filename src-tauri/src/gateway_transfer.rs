//! Transfer data never passes through shell syntax or command risk classification.
use crate::{
    agent_gateway::AgentGateway,
    gateway_audit::{private_dir, write_private},
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
pub const MAX_FILE: u64 = 256 * 1024 * 1024;
pub const CHUNK: usize = 64 * 1024;
#[derive(Clone, Serialize, Deserialize)]
pub struct Upload {
    pub id: String,
    pub server: String,
    pub identity: String,
    pub path: String,
    pub size: u64,
    pub sha256: String,
    pub offset: u64,
    pub status: String,
    pub overwrite: bool,
    #[serde(default)]
    pub cleaned: bool,
}
pub fn state_dir() -> Result<PathBuf, String> {
    let p = crate::agent_gateway::gateway_state_dir()?.join("uploads");
    private_dir(&p)?;
    Ok(p)
}
pub fn valid_id(id: &str) -> Result<(), String> {
    let parsed = uuid::Uuid::parse_str(id).map_err(|_| "无效任务ID")?;
    if parsed.to_string() != id {
        return Err("任务ID必须是标准小写UUID".into());
    }
    Ok(())
}
pub fn validate_path(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.is_absolute()
        || p.file_name().is_none()
        || path.contains('\0')
        || p.components().any(|c| {
            matches!(
                c,
                std::path::Component::ParentDir | std::path::Component::CurDir
            )
        })
    {
        return Err("目标必须是绝对文件路径，不能含 .. 或 NUL".into());
    }
    Ok(())
}
pub fn validate_manifest(path: &str, size: u64, hash: &str) -> Result<(), String> {
    validate_path(path)?;
    if size > MAX_FILE {
        return Err("单文件上限256 MiB".into());
    }
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("必须提供SHA-256".into());
    }
    Ok(())
}
pub fn lookup(id: &str) -> Result<Option<Upload>, String> {
    valid_id(id)?;
    let upload: Option<Upload> =
        crate::gateway_state::read(&state_dir()?.join(format!("{id}.json")))?;
    if upload.as_ref().is_some_and(|u| u.id != id) {
        return Err("上传记录ID不匹配".into());
    }
    Ok(upload)
}
pub fn load(id: &str) -> Result<Upload, String> {
    lookup(id)?.ok_or_else(|| "上传记录不存在".into())
}
pub fn save(u: &Upload) -> Result<(), String> {
    write_private(
        &state_dir()?.join(format!("{}.json", u.id)),
        &serde_json::to_vec(u).map_err(|e| e.to_string())?,
    )
}
fn data_path(u: &Upload) -> Result<PathBuf, String> {
    Ok(state_dir()?.join(format!("{}.part", u.id)))
}
pub fn create(
    gw: &AgentGateway,
    id: &str,
    server: &str,
    path: &str,
    size: u64,
    hash: &str,
    overwrite: bool,
) -> Result<Upload, String> {
    valid_id(id)?;
    validate_manifest(path, size, hash)?;
    let identity = gw.target_identity(server)?;
    if let Some(u) = lookup(id)? {
        if u.identity == identity
            && u.path == path
            && u.size == size
            && u.sha256 == hash.to_lowercase()
            && u.overwrite == overwrite
        {
            return Ok(u);
        }
        return Err("request_id已经用于不同上传，不会覆盖".into());
    }
    let _quota = crate::gateway_state::lock("uploads", "quota")?;
    let dir = state_dir()?;
    let mut active = 0;
    let mut records = 0;
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        if entry.path().extension().is_some_and(|s| s == "json") {
            if let Some(u) = crate::gateway_state::read::<Upload>(&entry.path())? {
                if !u.cleaned {
                    records += 1;
                }
                if u.status != "completed" && u.status != "aborted" {
                    active += 1;
                }
            }
        }
    }
    if active >= 4 || records >= 256 {
        return Err("上传记录/活动会话已达上限，请先abort或删除已完成记录".into());
    }
    let u = Upload {
        id: id.into(),
        server: server.into(),
        identity,
        path: path.into(),
        size,
        sha256: hash.to_lowercase(),
        offset: 0,
        status: "receiving".into(),
        overwrite,
        cleaned: false,
    };
    crate::gateway_state::create_private(&data_path(&u)?)?
        .sync_all()
        .map_err(|e| e.to_string())?;
    save(&u)?;
    Ok(u)
}
pub fn chunk(u: &mut Upload, offset: u64, encoded: &str) -> Result<(), String> {
    if u.status != "receiving" {
        return Err("上传不处于接收状态".into());
    }
    if encoded.len() > CHUNK.div_ceil(3) * 4 {
        return Err("分块上限64 KiB".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "无效Base64")?;
    if bytes.is_empty()
        || bytes.len() > CHUNK
        || offset
            .checked_add(bytes.len() as u64)
            .is_none_or(|end| end > u.size)
    {
        return Err("分块越界或为空".into());
    }
    let mut f = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(data_path(u)?)
        .map_err(|e| e.to_string())?;
    if offset < u.offset {
        if offset + bytes.len() as u64 > u.offset {
            return Err("分块与已确认范围部分重叠".into());
        }
        f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
        let mut old = vec![0; bytes.len()];
        f.read_exact(&mut old).map_err(|e| e.to_string())?;
        if old != bytes {
            return Err("重复分块内容冲突".into());
        }
        return Ok(());
    }
    if offset != u.offset {
        return Err(format!("期望offset={}，不会跳过缺失分块", u.offset));
    }
    f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    f.write_all(&bytes).map_err(|e| e.to_string())?;
    f.sync_data().map_err(|e| e.to_string())?;
    u.offset += bytes.len() as u64;
    save(u)
}
fn hash_reader(mut reader: impl Read) -> Result<String, String> {
    let mut hash = Sha256::new();
    let mut buf = [0; 65536];
    let mut total = 0;
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > MAX_FILE {
            return Err("远程文件超过校验上限".into());
        }
        hash.update(&buf[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
pub fn commit(gw: &AgentGateway, u: &mut Upload) -> Result<(), String> {
    if u.status == "completed" {
        return Ok(());
    }
    if u.status == "aborted" || u.offset != u.size {
        return Err("文件尚未完整上传或已终止".into());
    }
    gw.check_target_identity(&u.server, &u.identity)?;
    if hash_reader(fs::File::open(data_path(u)?).map_err(|e| e.to_string())?)? != u.sha256 {
        return Err("本地完整文件SHA-256不匹配".into());
    }
    let was_committing = u.status == "committing";
    u.status = "committing".into();
    save(u)?;
    let temp = PathBuf::from(format!("{}.ultimateshell-{}.part", u.path, u.id));
    let target = Path::new(&u.path);
    let opts = gw.resolve_target_opts(&u.server)?;
    if opts.is_local {
        let previous = match fs::symlink_metadata(target) {
            Ok(meta) => {
                if !meta.is_file() {
                    return Err("目标不是普通文件，不会覆盖目录或符号链接".into());
                }
                Some(meta)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.to_string()),
        };
        if was_committing
            && previous.as_ref().is_some_and(|meta| meta.len() == u.size)
            && hash_reader(fs::File::open(target).map_err(|e| e.to_string())?)? == u.sha256
        {
        } else {
            if !u.overwrite && target.exists() {
                return Err("目标已存在，未授权覆盖".into());
            }
            if was_committing && temp.symlink_metadata().is_ok() {
                fs::remove_file(&temp).map_err(|e| e.to_string())?;
            }
            let mut src = fs::File::open(data_path(u)?).map_err(|e| e.to_string())?;
            use std::os::unix::fs::OpenOptionsExt;
            let mut dest = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o600)
                .open(&temp)
                .map_err(|e| e.to_string())?;
            if u.overwrite {
                if let Some(meta) = previous.as_ref() {
                    use std::os::{
                        fd::AsRawFd,
                        unix::fs::{MetadataExt, PermissionsExt},
                    };
                    if unsafe { libc::fchown(dest.as_raw_fd(), meta.uid(), meta.gid()) } != 0 {
                        return Err(format!(
                            "无法保留目标所有者，未替换文件：{}",
                            std::io::Error::last_os_error()
                        ));
                    }
                    dest.set_permissions(fs::Permissions::from_mode(meta.mode() & 0o777))
                        .map_err(|e| e.to_string())?;
                }
            }
            std::io::copy(&mut src, &mut dest).map_err(|e| e.to_string())?;
            dest.sync_all().map_err(|e| e.to_string())?;
            if u.overwrite {
                fs::rename(&temp, target).map_err(|e| e.to_string())?
            } else {
                fs::hard_link(&temp, target).map_err(|e| e.to_string())?;
                fs::remove_file(&temp).map_err(|e| e.to_string())?
            }
        }
    } else {
        if u.overwrite {
            let (code, _, _) = gw.execute_bound(&u.server, &u.identity, "command -v python3")?;
            if code != 0 {
                return Err("远程原子覆盖需要Python 3，原文件未修改".into());
            }
        }
        let staged = gw.with_transfer_sftp_bound(&u.server, &u.identity, |sftp| {
            let previous = match sftp.lstat(target) {
                Ok(stat) => {
                    if !stat.is_file() {
                        return Err("目标不是普通文件，不会覆盖目录或符号链接".into());
                    }
                    Some(stat)
                }
                Err(e) if e.code() == ssh2::ErrorCode::SFTP(2) => None,
                Err(e) => return Err(e.to_string()),
            };
            if was_committing
                && previous
                    .as_ref()
                    .is_some_and(|stat| stat.size == Some(u.size))
            {
                if let Ok(f) = sftp.open(target) {
                    if hash_reader(f)? == u.sha256 {
                        return Ok(false);
                    }
                }
            }
            if !u.overwrite && previous.is_some() {
                return Err("目标已存在，未授权覆盖".into());
            }
            // Retry only this UUID's private staging file; never append blindly.
            let mut file = match sftp.open_mode(
                &temp,
                ssh2::OpenFlags::WRITE | ssh2::OpenFlags::CREATE | ssh2::OpenFlags::EXCLUSIVE,
                0o600,
                ssh2::OpenType::File,
            ) {
                Ok(f) => f,
                Err(e) => {
                    if was_committing {
                        sftp.unlink(&temp).map_err(|e| e.to_string())?;
                        sftp.open_mode(
                            &temp,
                            ssh2::OpenFlags::WRITE
                                | ssh2::OpenFlags::CREATE
                                | ssh2::OpenFlags::EXCLUSIVE,
                            0o600,
                            ssh2::OpenType::File,
                        )
                        .map_err(|e| e.to_string())?
                    } else {
                        return Err(e.to_string());
                    }
                }
            };
            let mut src = fs::File::open(data_path(u)?).map_err(|e| e.to_string())?;
            std::io::copy(&mut src, &mut file)
                .map_err(|e| format!("上传临时文件失败（账号保持原登录身份）：{e}"))?;
            if u.overwrite {
                if let Some(mut stat) = previous {
                    stat.size = None;
                    stat.atime = None;
                    stat.mtime = None;
                    stat.perm = stat.perm.map(|mode| mode & 0o777);
                    file.setstat(stat)
                        .map_err(|e| format!("无法保留目标所有者/权限，未替换文件：{e}"))?;
                }
            }
            file.flush().map_err(|e| e.to_string())?;
            file.close().map_err(|e| e.to_string())?;
            if hash_reader(sftp.open(&temp).map_err(|e| e.to_string())?)? != u.sha256 {
                return Err("远程临时文件SHA-256不匹配".into());
            }
            if !u.overwrite {
                sftp.rename(&temp, target, Some(ssh2::RenameFlags::empty()))
                    .map_err(|e| format!("提交远程文件失败；原文件不会被覆盖：{e}"))?;
            }
            Ok(u.overwrite)
        })?;
        if u.overwrite {
            // SFTP v3 rename ignores overwrite flags. os.replace provides an atomic overwrite without unlinking the old target first.
            let script = "import os,sys,stat; s,d=sys.argv[1:]; exists=os.path.lexists(d); assert not exists or stat.S_ISREG(os.lstat(d).st_mode), 'target is not a regular file'; os.replace(s,d)";
            let command = format!(
                "python3 -c {} {} {}",
                crate::gateway_jobs::quote(script),
                crate::gateway_jobs::quote(temp.to_str().ok_or("无效目标编码")?),
                crate::gateway_jobs::quote(&u.path)
            );
            // A retry may already have verified that the rename completed. Don't attempt to move a missing temp again.
            if staged {
                let (code, out, err) = gw.execute_bound(&u.server, &u.identity, &command)?;
                if code != 0 {
                    return Err(format!(
                        "原子覆盖未确认完成，保留临时文件，请用原ID查询；需要目标Python 3，exit={code}: {out} {err}"
                    ));
                }
            }
            let valid = gw.with_transfer_sftp_bound(&u.server, &u.identity, |s| {
                Ok(hash_reader(s.open(target).map_err(|e| e.to_string())?)? == u.sha256)
            })?;
            if !valid {
                return Err("提交后的远程文件哈希不匹配，状态待核查".into());
            }
        }
    }
    u.status = "completed".into();
    save(u)?;
    let _ = fs::remove_file(data_path(u)?);
    Ok(())
}
pub fn abort(gw: &AgentGateway, u: &mut Upload) -> Result<(), String> {
    if u.status == "completed" {
        return Err("已完成上传不能abort".into());
    }
    if u.status == "committing" {
        gw.check_target_identity(&u.server, &u.identity)?;
        let temp = PathBuf::from(format!("{}.ultimateshell-{}.part", u.path, u.id));
        if gw.resolve_target_opts(&u.server)?.is_local {
            if temp.exists() {
                fs::remove_file(temp).map_err(|e| e.to_string())?
            }
        } else {
            gw.with_transfer_sftp_bound(&u.server, &u.identity, |s| {
                if s.lstat(&temp).is_ok() {
                    s.unlink(&temp).map_err(|e| e.to_string())?
                }
                Ok(())
            })?;
        }
    }
    u.status = "aborted".into();
    save(u)?;
    let _ = fs::remove_file(data_path(u)?);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reject_bad_manifest() {
        assert!(validate_manifest("/tmp/a", 0, &"a".repeat(64)).is_ok());
        for p in ["a", "/tmp/../a", "/", "/a\0b"] {
            assert!(validate_manifest(p, 0, &"a".repeat(64)).is_err());
        }
        assert!(validate_manifest("/a", MAX_FILE + 1, &"a".repeat(64)).is_err());
        assert!(validate_manifest("/a", 1, "bad").is_err());
    }
    #[test]
    fn hash_is_streamed() {
        assert_eq!(
            hash_reader(&b"abc"[..]).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
