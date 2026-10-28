#[cfg(target_os = "macos")]
mod native_menu;
mod hosts;
mod ops;
mod perf;
mod pty;
mod ssh_auth;
mod sftp;
mod transfer;
mod vault;

use hosts::{load_hosts, save_hosts, HostProfile};
use ops::{DiskPartition, ProcessEntry};
use perf::{PerfManager, SystemPerfStats};
use pty::{PtyManager, SpawnOptions};
use sftp::{DirResult, SftpPool};
use transfer::TransferState;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};

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
    mode: Option<String>,
    max_bytes: Option<usize>,
) -> Result<sftp::PreviewResult, String> {
    let opts = pty_mgr
        .get_opts(&session_id)
        .ok_or_else(|| "会话不存在或已关闭".to_string())?;

    let pool = sftp_pool.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        sftp::read_file_preview_content(&pool, &opts, &path, mode, max_bytes)
    })
    .await
    .map_err(|e| format!("异步执行错误: {}", e))?
}

#[tauri::command]
async fn fs_save_file(
    pty_mgr: State<'_, PtyManager>,
    sftp_pool: State<'_, SftpPool>,
    session_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let opts = pty_mgr
        .get_opts(&session_id)
        .ok_or_else(|| "会话不存在或已关闭".to_string())?;

    let pool = sftp_pool.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        sftp::save_file_content(&pool, &opts, &path, &content)
    })
    .await
    .map_err(|e| format!("异步执行错误: {}", e))?
}

#[tauri::command]
async fn fs_rename(
    pty_mgr: State<'_, PtyManager>,
    sftp_pool: State<'_, SftpPool>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let opts = pty_mgr
        .get_opts(&session_id)
        .ok_or_else(|| "会话不存在或已关闭".to_string())?;

    let pool = sftp_pool.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        sftp::rename_file(&pool, &opts, &old_path, &new_path)
    })
    .await
    .map_err(|e| format!("异步执行错误: {}", e))?
}

#[tauri::command]
async fn fs_create_file(
    pty_mgr: State<'_, PtyManager>,
    sftp_pool: State<'_, SftpPool>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    println!("[IPC:fs_create_file] sessionId={}, path={}", session_id, path);
    let opts = pty_mgr
        .get_opts(&session_id)
        .ok_or_else(|| "会话不存在或已关闭".to_string())?;

    let pool = sftp_pool.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        sftp::create_file(&pool, &opts, &path)
    })
    .await
    .map_err(|e| format!("异步执行错误: {}", e))?
}

#[tauri::command]
async fn fs_create_dir(
    pty_mgr: State<'_, PtyManager>,
    sftp_pool: State<'_, SftpPool>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    println!("[IPC:fs_create_dir] sessionId={}, path={}", session_id, path);
    let opts = pty_mgr
        .get_opts(&session_id)
        .ok_or_else(|| "会话不存在或已关闭".to_string())?;

    let pool = sftp_pool.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        sftp::create_dir(&pool, &opts, &path)
    })
    .await
    .map_err(|e| format!("异步执行错误: {}", e))?
}

#[tauri::command]
async fn fs_delete(
    pty_mgr: State<'_, PtyManager>,
    sftp_pool: State<'_, SftpPool>,
    session_id: String,
    path: String,
    is_dir: bool,
    use_trash: bool,
) -> Result<String, String> {
    println!("[IPC:fs_delete] sessionId={}, path={}, is_dir={}, use_trash={}", session_id, path, is_dir, use_trash);
    let opts = pty_mgr
        .get_opts(&session_id)
        .ok_or_else(|| "会话不存在或已关闭".to_string())?;

    let pool = sftp_pool.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        sftp::delete_entry(&pool, &opts, &path, is_dir, use_trash)
    })
    .await
    .map_err(|e| format!("异步执行错误: {}", e))?
}

#[tauri::command]
fn fs_get_trash_dir() -> String {
    std::env::var("HOME")
        .map(|h| format!("{}/.ultimateshell/trash", h))
        .unwrap_or_else(|_| ".ultimateshell_trash".to_string())
}

#[tauri::command]
fn fs_clear_trash() -> Result<(), String> {
    let trash_dir = fs_get_trash_dir();
    let _ = std::fs::remove_dir_all(&trash_dir);
    let _ = std::fs::create_dir_all(&trash_dir);
    Ok(())
}

#[tauri::command]
async fn fs_download_file(
    app: AppHandle,
    pty_mgr: State<'_, PtyManager>,
    sftp_pool: State<'_, SftpPool>,
    transfer_state: State<'_, TransferState>,
    session_id: String,
    remote_path: String,
    local_path: String,
    task_id: String,
) -> Result<(), String> {
    let opts = pty_mgr
        .get_opts(&session_id)
        .ok_or_else(|| "会话不存在或已关闭".to_string())?;

    let pool = sftp_pool.inner().clone();
    let cancel_flag = transfer_state.register(&task_id);
    let t_state = transfer_state.inner().clone();
    let tid = task_id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let res = sftp::download_file(
            app,
            &pool,
            &opts,
            &remote_path,
            &local_path,
            &tid,
            cancel_flag,
        );
        t_state.remove(&tid);
        res
    })
    .await
    .map_err(|e| format!("异步执行错误: {}", e))?
}

#[tauri::command]
async fn fs_upload_file(
    app: AppHandle,
    pty_mgr: State<'_, PtyManager>,
    sftp_pool: State<'_, SftpPool>,
    transfer_state: State<'_, TransferState>,
    session_id: String,
    local_path: String,
    remote_path: String,
    task_id: String,
) -> Result<(), String> {
    let opts = pty_mgr
        .get_opts(&session_id)
        .ok_or_else(|| "会话不存在或已关闭".to_string())?;

    let pool = sftp_pool.inner().clone();
    let cancel_flag = transfer_state.register(&task_id);
    let t_state = transfer_state.inner().clone();
    let tid = task_id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let res = sftp::upload_file(
            app,
            &pool,
            &opts,
            &local_path,
            &remote_path,
            &tid,
            cancel_flag,
        );
        t_state.remove(&tid);
        res
    })
    .await
    .map_err(|e| format!("异步执行错误: {}", e))?
}

#[tauri::command]
fn fs_cancel_transfer(transfer_state: State<TransferState>, task_id: String) -> bool {
    transfer_state.cancel(&task_id)
}

#[tauri::command]
fn fs_get_default_download_dir() -> String {
    std::env::var("HOME")
        .map(|h| format!("{}/Downloads", h))
        .unwrap_or_else(|_| ".".to_string())
}

#[tauri::command]
fn switch_to_ascii_input() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn get_session_user(pty_mgr: State<PtyManager>, session_id: String) -> String {
    pty_mgr.get_user(&session_id)
}

#[tauri::command]
fn is_session_root_capable(pty_mgr: State<PtyManager>, session_id: String) -> bool {
    pty_mgr.is_root_capable(&session_id)
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
fn save_host_password(host_id: String, password: String) -> Result<(), String> {
    vault::save_password(&host_id, &password)
}

#[tauri::command]
fn get_host_password(host_id: String) -> Option<String> {
    vault::get_password(&host_id)
}

#[tauri::command]
async fn get_server_users(
    pty_mgr: State<'_, PtyManager>,
    sftp_pool: State<'_, SftpPool>,
    session_id: String,
) -> Result<Vec<ops::ServerUser>, String> {
    let opts = pty_mgr
        .get_opts(&session_id)
        .ok_or_else(|| "会话不存在或已关闭".to_string())?;

    let pool = sftp_pool.inner().clone();
    tauri::async_runtime::spawn_blocking(move || ops::get_server_users(&pool, &opts))
        .await
        .map_err(|e| format!("异步执行错误: {}", e))?
}

#[tauri::command]
fn save_server_user_password(host_id: String, username: String, password: String) -> Result<(), String> {
    let key = format!("{}:user:{}", host_id, username);
    vault::save_password(&key, &password)
}

#[tauri::command]
fn get_server_user_password(host_id: String, username: String) -> Option<String> {
    let key = format!("{}:user:{}", host_id, username);
    vault::get_password(&key)
}

#[tauri::command]
fn delete_server_user_password(host_id: String, username: String) -> Result<(), String> {
    let key = format!("{}:user:{}", host_id, username);
    vault::delete_password(&key)
}

#[tauri::command]
fn switch_session_user(
    pty_mgr: State<PtyManager>,
    session_id: String,
    target_user: String,
    password: Option<String>,
) -> Result<(), String> {
    pty_mgr.switch_user(&session_id, &target_user, password)
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

#[tauri::command]
async fn get_process_list(
    pty_mgr: State<'_, PtyManager>,
    sftp_pool: State<'_, SftpPool>,
    session_id: String,
) -> Result<Vec<ProcessEntry>, String> {
    let opts = pty_mgr
        .get_opts(&session_id)
        .ok_or_else(|| "会话不存在或已关闭".to_string())?;

    let pool = sftp_pool.inner().clone();
    tauri::async_runtime::spawn_blocking(move || ops::get_processes(&pool, &opts))
        .await
        .map_err(|e| format!("异步执行错误: {}", e))?
}

#[tauri::command]
async fn kill_process(
    pty_mgr: State<'_, PtyManager>,
    sftp_pool: State<'_, SftpPool>,
    session_id: String,
    pid: u32,
    signal: i32,
) -> Result<(), String> {
    let opts = pty_mgr
        .get_opts(&session_id)
        .ok_or_else(|| "会话不存在或已关闭".to_string())?;

    let pool = sftp_pool.inner().clone();
    tauri::async_runtime::spawn_blocking(move || ops::kill_proc(&pool, &opts, pid, signal))
        .await
        .map_err(|e| format!("异步执行错误: {}", e))?
}

#[tauri::command]
async fn get_disk_partitions(
    pty_mgr: State<'_, PtyManager>,
    sftp_pool: State<'_, SftpPool>,
    session_id: String,
) -> Result<Vec<DiskPartition>, String> {
    let opts = pty_mgr
        .get_opts(&session_id)
        .ok_or_else(|| "会话不存在或已关闭".to_string())?;

    let pool = sftp_pool.inner().clone();
    tauri::async_runtime::spawn_blocking(move || ops::get_disks(&pool, &opts))
        .await
        .map_err(|e| format!("异步执行错误: {}", e))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_mgr = PtyManager::new();
    let sftp_pool = SftpPool::new();
    let perf_mgr = PerfManager::new();
    let transfer_state = TransferState::new();

    tauri::Builder::default()
        .manage(pty_mgr)
        .manage(sftp_pool)
        .manage(perf_mgr)
        .manage(transfer_state)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let new_term_item = MenuItem::with_id(app, "new_term", "新建本地终端", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 UltimateShell", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &new_term_item, &quit_item])?;

            if let Some(icon) = app.default_window_icon().cloned() {
                let _tray = TrayIconBuilder::new()
                    .icon(icon)
                    .tooltip("UltimateShell")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| {
                        match event.id().as_ref() {
                            "show" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                }
                            }
                            "new_term" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                    let _ = window.emit("tray-new-local-tab", ());
                                }
                            }
                            "quit" => {
                                app.exit(0);
                            }
                            _ => {}
                        }
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    })
                    .build(app)?;
            }

            #[cfg(target_os = "macos")]
            native_menu::install(app)?;

            app.on_menu_event(|app_handle, event| {
                let id = event.id().as_ref();
                if id.starts_with("menu-") {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                        let _ = window.emit("menu-action", id);
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close,
            switch_to_ascii_input,
            get_session_stats,
            get_session_user,
            is_session_root_capable,
            get_system_perf,
            get_process_list,
            kill_process,
            get_disk_partitions,
            get_hosts,
            save_host,
            update_host_access_time,
            delete_host,
            save_host_password,
            get_host_password,
            get_server_users,
            save_server_user_password,
            get_server_user_password,
            delete_server_user_password,
            switch_session_user,
            fs_list_dir,
            fs_read_preview,
            fs_save_file,
            fs_rename,
            fs_create_file,
            fs_create_dir,
            fs_delete,
            fs_get_trash_dir,
            fs_clear_trash,
            fs_download_file,
            fs_upload_file,
            fs_cancel_transfer,
            fs_get_default_download_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
