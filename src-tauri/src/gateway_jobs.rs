//! Durable remote jobs: gateway restarts never replay a deployment.
use crate::{
    agent_gateway::AgentGateway,
    gateway_audit::{private_dir, write_private},
    gateway_transfer::valid_id,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
#[derive(Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub server: String,
    pub identity: String,
    pub command_sha256: String,
    pub status: String,
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub pid: Option<u32>,
    pub directory: String,
    pub created_at: String,
    #[serde(default)]
    pub owns_directory: bool,
}
pub fn quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
fn dir() -> Result<PathBuf, String> {
    let p = crate::agent_gateway::gateway_state_dir()?.join("jobs");
    private_dir(&p)?;
    Ok(p)
}
pub fn lookup(id: &str) -> Result<Option<Job>, String> {
    valid_id(id)?;
    let job: Option<Job> = crate::gateway_state::read(&dir()?.join(format!("{id}.json")))?;
    if job.as_ref().is_some_and(|j| j.id != id) {
        return Err("任务记录ID不匹配".into());
    }
    Ok(job)
}
pub fn load(id: &str) -> Result<Job, String> {
    lookup(id)?.ok_or_else(|| "任务记录不存在".into())
}
fn save(job: &Job) -> Result<(), String> {
    write_private(
        &dir()?.join(format!("{}.json", job.id)),
        &serde_json::to_vec(job).map_err(|e| e.to_string())?,
    )
}
fn scripts(command: &str, directory: &str) -> (String, String) {
    // Only the supervisor's retained logs are bounded; no inherited RLIMIT_FSIZE on user commands.
    let command = format!("#!/bin/sh\n{command}\n");
    let d = quote(directory);
    let runner = format!(
        "#!/bin/sh\numask 077\ncd {d} || exit 125\npython3 ./capture.py 2>./supervisor.stderr\n# Retain this wrapper PID for status checks; no fabricated task exit on supervisor failure.\nexit $?\n"
    );
    (command, runner)
}
pub fn create(gw: &AgentGateway, id: &str, server: &str, command: &str) -> Result<Job, String> {
    valid_id(id)?;
    crate::gateway_io::validate_command(command)?;
    let hash = format!("{:x}", Sha256::digest(command.as_bytes()));
    let identity = gw.target_identity(server)?;
    if let Some(j) = lookup(id)? {
        if j.identity == identity && j.command_sha256 == hash {
            return Ok(j);
        }
        return Err("request_id已用于不同任务".into());
    }
    let _quota = crate::gateway_state::lock("jobs", "quota")?;
    let mut records = 0;
    for entry in fs::read_dir(dir()?).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().extension().is_some_and(|e| e == "json") {
            if let Some(job) = crate::gateway_state::read::<Job>(&entry.path())? {
                if job.status != "cleaned" {
                    records += 1;
                }
            }
        }
    }
    if records >= 128 {
        return Err("任务记录已达128条，请清理已结束任务".into());
    }
    let (python_code, _, _) = gw.execute_on_target(server, "command -v python3")?;
    if python_code != 0 {
        return Err("目标服务器未安装Python 3，后台任务未启动".into());
    }
    let local = gw.resolve_target_opts(server)?.is_local;
    let directory = if local {
        dir()?
            .join(format!("run-{id}"))
            .to_string_lossy()
            .into_owned()
    } else {
        format!("/tmp/ultimateshell-job-{id}")
    };
    let mut job = Job {
        id: id.into(),
        server: server.into(),
        identity,
        command_sha256: hash,
        status: "starting".into(),
        exit_code: None,
        pid: None,
        directory,
        created_at: chrono::Utc::now().to_rfc3339(),
        owns_directory: false,
    };
    // Persist BEFORE launch. An uncertain launch is never resubmitted with the same ID.
    save(&job)?;
    let (command_script, runner) = scripts(command, &job.directory);
    let setup = (|| -> Result<(), String> {
        if local {
            crate::gateway_state::new_private_dir(Path::new(&job.directory))?;
            job.owns_directory = true;
            save(&job)?;
            write_private(
                &Path::new(&job.directory).join("command.sh"),
                command_script.as_bytes(),
            )?;
            write_private(
                &Path::new(&job.directory).join("runner.sh"),
                runner.as_bytes(),
            )?;
            write_private(
                &Path::new(&job.directory).join("capture.py"),
                include_bytes!("gateway_job_capture.py"),
            )?;
        } else {
            let identity = job.identity.clone();
            gw.with_sftp_bound(server, &identity, |s| {
                s.mkdir(Path::new(&job.directory), 0o700)
                    .map_err(|e| e.to_string())?;
                job.owns_directory = true;
                save(&job)?;
                for (name, data) in [
                    ("command.sh", command_script.as_bytes()),
                    ("runner.sh", runner.as_bytes()),
                    (
                        "capture.py",
                        include_bytes!("gateway_job_capture.py").as_slice(),
                    ),
                ] {
                    let mut f = s
                        .open_mode(
                            &Path::new(&job.directory).join(name),
                            ssh2::OpenFlags::WRITE
                                | ssh2::OpenFlags::CREATE
                                | ssh2::OpenFlags::EXCLUSIVE,
                            0o600,
                            ssh2::OpenType::File,
                        )
                        .map_err(|e| e.to_string())?;
                    f.write_all(data).map_err(|e| e.to_string())?;
                    f.close().map_err(|e| e.to_string())?;
                }
                Ok(())
            })?;
        }
        Ok(())
    })();
    if let Err(e) = setup {
        job.status = "setup_failed".into();
        save(&job)?;
        return Err(format!("任务准备失败（未启动），ID={id}：{e}"));
    }
    let launch = format!(
        "nohup sh {} </dev/null >/dev/null 2>&1 & echo $!",
        quote(&format!("{}/runner.sh", job.directory))
    );
    match gw.execute_bound(server, &job.identity, &launch) {
        Ok((0, stdout, _)) => {
            job.pid = stdout.trim().parse::<u32>().ok().filter(|p| *p > 1);
            job.status = if job.pid.is_some() {
                "running"
            } else {
                "unknown"
            }
            .into();
        }
        Ok((code, _, err)) => {
            job.status = "unknown".into();
            save(&job)?;
            return Err(format!("启动结果待核查，ID={id}，exit={code}：{err}"));
        }
        Err(e) => {
            job.status = "unknown".into();
            save(&job)?;
            return Err(format!(
                "启动结果未知，ID={id}，请查询同一任务，不要重新执行：{e}"
            ));
        }
    }
    save(&job)?;
    Ok(job)
}
fn read_job_file(
    gw: &AgentGateway,
    job: &Job,
    name: &str,
    offset: u64,
    limit: u64,
) -> Result<Option<Vec<u8>>, String> {
    let path = Path::new(&job.directory).join(name);
    fn read(mut file: impl Read + Seek, offset: u64, limit: u64) -> Result<Vec<u8>, String> {
        file.seek(SeekFrom::Start(offset))
            .map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        file.take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        Ok(bytes)
    }
    if gw.resolve_target_opts(&job.server)?.is_local {
        use std::os::unix::fs::OpenOptionsExt;
        match fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)
        {
            Ok(f) => {
                if !f.metadata().map_err(|e| e.to_string())?.is_file() {
                    return Err("任务输出不是普通文件".into());
                }
                read(f, offset, limit).map(Some)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    } else {
        gw.with_sftp_bound(&job.server, &job.identity, |s| match s.open(&path) {
            Ok(f) => read(f, offset, limit).map(Some),
            Err(e) if e.code() == ssh2::ErrorCode::SFTP(2) => Ok(None),
            Err(e) => Err(e.to_string()),
        })
    }
}
fn outcome(
    gw: &AgentGateway,
    job: &Job,
) -> Result<Option<(String, Option<i32>, Option<String>)>, String> {
    if let Some(bytes) = read_job_file(gw, job, "result.json", 0, 8192)? {
        if bytes.len() > 8192 {
            return Err("任务结果记录过大；结果待核查".into());
        }
        let value: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|e| format!("任务结果损坏；结果待核查：{e}"))?;
        let status = value
            .get("status")
            .and_then(|v| v.as_str())
            .ok_or("任务结果缺少状态")?;
        let code = value
            .get("exit_code")
            .and_then(|v| v.as_i64())
            .and_then(|n| i32::try_from(n).ok());
        let error = value
            .get("capture_error")
            .and_then(|v| v.as_str())
            .map(str::to_owned);
        if !["success", "error", "unknown", "setup_failed"].contains(&status)
            || status == "success" && (code != Some(0) || error.is_some())
            || status == "setup_failed"
                && value.get("task_started").and_then(|v| v.as_bool()) != Some(false)
        {
            return Err("任务结果字段冲突；结果待核查".into());
        }
        return Ok(Some((status.into(), code, error)));
    }
    if let Some(bytes) = read_job_file(gw, job, "exit", 0, 32)? {
        if bytes.len() > 32 {
            return Err("退出码记录异常".into());
        }
        let text = std::str::from_utf8(&bytes).map_err(|e| e.to_string())?;
        let code = text.trim().parse::<i32>().map_err(|_| "退出码记录无效")?;
        return Ok(Some((
            if code == 0 { "success" } else { "error" }.into(),
            Some(code),
            None,
        )));
    }
    Ok(None)
}
pub fn poll(
    gw: &AgentGateway,
    job: &mut Job,
    offset: u64,
    stderr_offset: u64,
) -> Result<serde_json::Value, String> {
    if job.status == "cleaned" {
        return Ok(serde_json::json!({"ok":true,"job":job}));
    }
    if offset > 8 * 1024 * 1024 || stderr_offset > 8 * 1024 * 1024 {
        return Err("输出偏移超过日志保留范围".into());
    }
    gw.check_target_identity(&job.server, &job.identity)?;
    let mut result = outcome(gw, job)?;
    if result.is_none() && ["running", "starting", "unknown"].contains(&job.status.as_str()) {
        let alive = if let Some(pid) = job.pid {
            let (code, out, _) =
                gw.execute_bound(&job.server, &job.identity, &format!("ps -p {pid} -o args="))?;
            code == 0 && out.contains(&format!("{}/runner.sh", job.directory))
        } else {
            false
        };
        if !alive {
            result = outcome(gw, job)?;
            if result.is_none() {
                job.status = "unknown".into();
                save(job)?;
            }
        }
    }
    let mut capture_error = None;
    if let Some((status, code, error)) = result {
        job.status = status;
        job.exit_code = code;
        capture_error = error;
        save(job)?;
    }
    let stdout = read_job_file(gw, job, "stdout", offset, 65536)?.unwrap_or_default();
    let stderr = read_job_file(gw, job, "stderr", stderr_offset, 65536)?.unwrap_or_default();
    let stdout = &stdout[..stdout.len().min(65536)];
    let stderr = &stderr[..stderr.len().min(65536)];
    let stdout_truncated = read_job_file(gw, job, "stdout.truncated", 0, 128)?.is_some();
    let stderr_truncated = read_job_file(gw, job, "stderr.truncated", 0, 128)?.is_some();
    let supervisor = read_job_file(gw, job, "supervisor.stderr", 0, 4096)?.unwrap_or_default();
    Ok(
        serde_json::json!({"ok":true,"job":job,"capture_error":capture_error.map(|s|crate::agent_gateway::redact_sensitive_output(&s)),"supervisor_stderr":crate::agent_gateway::redact_sensitive_output(&String::from_utf8_lossy(&supervisor)),"stdout":crate::agent_gateway::redact_sensitive_output(&String::from_utf8_lossy(stdout)),"stderr":crate::agent_gateway::redact_sensitive_output(&String::from_utf8_lossy(stderr)),"stdout_offset":offset+stdout.len() as u64,"stderr_offset":stderr_offset+stderr.len() as u64,"stdout_truncated":stdout_truncated,"stderr_truncated":stderr_truncated,"encoding":"utf-8-lossy; offsets are raw bytes"}),
    )
}
pub fn cleanup(gw: &AgentGateway, job: &mut Job) -> Result<(), String> {
    if job.status == "cleaned" {
        return Ok(());
    }
    if job.exit_code.is_none() && job.status != "setup_failed" && job.status != "cleaned" {
        return Err("任务未确认结束，不能清理".into());
    }
    if !job.owns_directory && job.status == "setup_failed" {
        job.status = "cleaned".into();
        return save(job);
    }
    gw.check_target_identity(&job.server, &job.identity)?;
    let p = Path::new(&job.directory);
    if gw.resolve_target_opts(&job.server)?.is_local {
        if p.exists() {
            fs::remove_dir_all(p).map_err(|e| e.to_string())?;
        }
    } else {
        gw.with_sftp_bound(&job.server, &job.identity, |s| {
            for n in [
                "command.sh",
                "runner.sh",
                "capture.py",
                "result.json",
                "result.json.tmp",
                "supervisor.stderr",
                "stdout.truncated",
                "stderr.truncated",
                "stdout",
                "stderr",
                "exit",
                "exit.tmp",
            ] {
                let path = p.join(n);
                if s.lstat(&path).is_ok() {
                    s.unlink(&path).map_err(|e| e.to_string())?
                }
            }
            s.rmdir(p).map_err(|e| e.to_string())
        })?;
    }
    job.status = "cleaned".into();
    save(job)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scripts_capture_exit_and_survive_shell_quoting() {
        let dir = std::env::temp_dir().join(format!("job-'{}", uuid::Uuid::new_v4()));
        private_dir(&dir).unwrap();
        let (c, r) = scripts(
            "printf hello; printf err >&2; exit 7",
            dir.to_str().unwrap(),
        );
        fs::write(dir.join("command.sh"), c).unwrap();
        fs::write(dir.join("runner.sh"), r).unwrap();
        fs::write(
            dir.join("capture.py"),
            include_bytes!("gateway_job_capture.py"),
        )
        .unwrap();
        assert!(
            std::process::Command::new("sh")
                .arg(dir.join("runner.sh"))
                .status()
                .unwrap()
                .success()
        );
        assert_eq!(fs::read_to_string(dir.join("exit")).unwrap(), "7\n");
        assert_eq!(fs::read_to_string(dir.join("stdout")).unwrap(), "hello");
        assert_eq!(fs::read_to_string(dir.join("stderr")).unwrap(), "err");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn job_large_data_files_are_unlimited_but_both_logs_are_bounded_and_drained() {
        let dir = std::env::temp_dir().join(format!("job-large-{}", uuid::Uuid::new_v4()));
        private_dir(&dir).unwrap();
        let (command, runner) = scripts(
            "python3 - <<'PY'\nimport sys\nfrom pathlib import Path\nPath('application-data.bin').write_bytes(b'd' * (20 * 1024 * 1024))\nsys.stdout.buffer.write(b'o' * (10 * 1024 * 1024))\nsys.stdout.buffer.flush()\nsys.stderr.buffer.write(b'e' * (10 * 1024 * 1024))\nsys.stderr.buffer.flush()\nPath('after-output-limit').write_text('completed')\nPY",
            dir.to_str().unwrap(),
        );
        fs::write(dir.join("command.sh"), command).unwrap();
        fs::write(dir.join("runner.sh"), runner).unwrap();
        fs::write(
            dir.join("capture.py"),
            include_bytes!("gateway_job_capture.py"),
        )
        .unwrap();
        assert!(
            std::process::Command::new("sh")
                .arg(dir.join("runner.sh"))
                .status()
                .unwrap()
                .success()
        );
        assert_eq!(fs::read_to_string(dir.join("exit")).unwrap(), "0\n");
        assert_eq!(
            fs::metadata(dir.join("application-data.bin"))
                .unwrap()
                .len(),
            20 * 1024 * 1024
        );
        for name in ["stdout", "stderr"] {
            assert_eq!(fs::metadata(dir.join(name)).unwrap().len(), 8 * 1024 * 1024);
            assert_eq!(
                fs::read_to_string(dir.join(format!("{name}.truncated"))).unwrap(),
                format!("{}\n", 2 * 1024 * 1024)
            );
        }
        assert!(dir.join("after-output-limit").exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
