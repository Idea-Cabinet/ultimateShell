mod hosts;
mod perf;
mod pty;
mod ssh_auth;
mod sftp;
mod vault;

use hosts::{import_from_finalshell, load_hosts, save_hosts, HostProfile};
use perf::{PerfManager, SystemPerfStats};
use pty::{PtyManager, SpawnOptions};
use sftp::{DirResult, SftpPool};
use tauri::{AppHandle, State};

#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    pty_mgr: State<PtyManager>,
    opts: SpawnOptions,
) -> Result<(), String> {
    pty_mgr.spawn(app, opts)
}

#[tauri::command]
fn pty_write(
    pty_mgr: State<PtyManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    pty_mgr.write(&session_id, &data)
}

#[tauri::command]
fn pty_resize(
    pty_mgr: State<PtyManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty_mgr.resize(&session_id, cols, rows)
}

#[tauri::command]
fn pty_close(
    pty_mgr: State<PtyManager>,
    sftp_pool: State<SftpPool>,
    session_id: String,
) -> Result<(), String> {
    sftp_pool.close(&session_id);
    pty_mgr.close(&session_id)
}

#[tauri::command]
async fn fs_list_dir(
    pty_mgr: State<'_, PtyManager>,
    sftp_pool: State<'_, SftpPool>,
    session_id: String,
    path: String,
    show_hidden: bool,
) -> Result<DirResult, String> {
    let opts = pty_mgr
        .get_opts(&session_id)
        .ok_or_else(|| "会话不存在或已关闭".to_string())?;

    let pool = sftp_pool.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if opts.is_local {
            sftp::list_local_dir(&path, show_hidden)
        } else {
            sftp::list_remote_dir(&pool, &opts, &path, show_hidden)
        }
    })
    .await
    .map_err(|e| format!("异步执行错误: {}", e))?
}

#[tauri::command]
async fn fs_read_preview(
    pty_mgr: State<'_, PtyManager>,
    sftp_pool: State<'_, SftpPool>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    let opts = pty_mgr
        .get_opts(&session_id)
        .ok_or_else(|| "会话不存在或已关闭".to_string())?;

    let pool = sftp_pool.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        sftp::read_file_preview_content(&pool, &opts, &path, 64 * 1024)
    })
    .await
    .map_err(|e| format!("异步执行错误: {}", e))?
}

#[cfg(target_os = "macos")]
#[link(name = "Carbon", kind = "framework")]
unsafe extern "C" {
    fn TISCopyCurrentASCIICapableKeyboardInputSource() -> *mut std::ffi::c_void;
    fn TISSelectInputSource(source: *mut std::ffi::c_void) -> i32;
    fn CFRelease(cf: *mut std::ffi::c_void);
}

#[tauri::command]
fn switch_to_ascii_input() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    unsafe {
        let source = TISCopyCurrentASCIICapableKeyboardInputSource();
        if !source.is_null() {
            let res = TISSelectInputSource(source);
            CFRelease(source);
            if res != 0 {
                return Err(format!("TISSelectInputSource failed with code {}", res));
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn get_session_user(pty_mgr: State<PtyManager>, session_id: String) -> String {
    pty_mgr.get_user(&session_id)
}

#[tauri::command]
async fn get_session_stats(pty_mgr: State<'_, PtyManager>, session_id: String) -> Result<(String, usize), String> {
    let mgr = pty_mgr.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        mgr.get_cwd_stats(&session_id)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_hosts() -> Vec<HostProfile> {
    load_hosts()
}

#[tauri::command]
fn save_host(mut host: HostProfile, password: Option<String>) -> Result<HostProfile, String> {
    if host.id.trim().is_empty() {
        host.id = uuid::Uuid::new_v4().to_string();
    }
    if let Some(pwd) = password {
        if !pwd.trim().is_empty() {
            vault::save_password(&host.id, &pwd)?;
            host.has_password = Some(true);
        }
    }
    let mut current = load_hosts();
    if let Some(pos) = current.iter().position(|h| h.id == host.id) {
        current[pos] = host.clone();
    } else {
        if host.create_time.is_none() {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            host.create_time = Some(now);
        }
        current.push(host.clone());
    }
    save_hosts(&current)?;
    Ok(host)
}

#[tauri::command]
fn update_host_access_time(host_id: String) -> Result<(), String> {
    let mut current = load_hosts();
    if let Some(pos) = current.iter().position(|h| h.id == host_id) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        current[pos].access_time = Some(now);
        save_hosts(&current)?;
    }
    Ok(())
}

#[tauri::command]
fn delete_host(id: String) -> Result<(), String> {
    let mut current = load_hosts();
    current.retain(|h| h.id != id);
    save_hosts(&current)
}

#[tauri::command]
fn import_finalshell() -> Result<Vec<HostProfile>, String> {
    import_from_finalshell()
}

#[tauri::command]
fn save_host_password(host_id: String, password: String) -> Result<(), String> {
    vault::save_password(&host_id, &password)
}

#[tauri::command]
fn get_host_password(host_id: String) -> Option<String> {
    vault::get_password(&host_id)
}

#[tauri::command]
async fn get_system_perf(
    pty_mgr: State<'_, PtyManager>,
    sftp_pool: State<'_, SftpPool>,
    perf_mgr: State<'_, PerfManager>,
    session_id: String,
) -> Result<SystemPerfStats, String> {
    let opts = pty_mgr
        .get_opts(&session_id)
        .ok_or_else(|| "会话不存在或已关闭".to_string())?;

    let pool = sftp_pool.inner().clone();
    let mgr = perf_mgr.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        mgr.get_perf(&pool, &opts)
    })
    .await
    .map_err(|e| format!("异步执行错误: {}", e))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_mgr = PtyManager::new();
    let sftp_pool = SftpPool::new();
    let perf_mgr = PerfManager::new();

    tauri::Builder::default()
        .manage(pty_mgr)
        .manage(sftp_pool)
        .manage(perf_mgr)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close,
            switch_to_ascii_input,
            get_session_stats,
            get_session_user,
            get_system_perf,
            get_hosts,
            save_host,
            update_host_access_time,
            delete_host,
            import_finalshell,
            save_host_password,
            get_host_password,
            fs_list_dir,
            fs_read_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
