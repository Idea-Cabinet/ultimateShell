mod hosts;
mod ops;
mod perf;
mod pty;
mod ssh_auth;
mod sftp;
mod vault;

use hosts::{load_hosts, save_hosts, HostProfile};
use ops::{DiskPartition, ProcessEntry};
use perf::{PerfManager, SystemPerfStats};
use pty::{PtyManager, SpawnOptions};
use sftp::{DirResult, SftpPool};
use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuItem, MenuItemBuilder, SubmenuBuilder};
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

#[tauri::command]
fn switch_to_ascii_input() -> Result<(), String> {
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

    tauri::Builder::default()
        .manage(pty_mgr)
        .manage(sftp_pool)
        .manage(perf_mgr)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "显示主窗口 / Show Window", true, None::<&str>)?;
            let new_term_item = MenuItem::with_id(app, "new_term", "新建本地终端 / New Terminal", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 UltimateShell / Quit", true, None::<&str>)?;
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
            {
                // 1. App Submenu (macOS primary app menu next to Apple logo)
                let app_menu = SubmenuBuilder::new(app, "UltimateShell")
                    .about(Some(AboutMetadata {
                        name: Some("UltimateShell".into()),
                        version: Some("0.1.0".into()),
                        comments: Some("Next-Generation Terminal & Ops Tool".into()),
                        ..Default::default()
                    }))
                    .separator()
                    .item(&MenuItemBuilder::with_id("menu-settings", "偏好设置... / Preferences...").accelerator("CmdOrCtrl+,").build(app)?)
                    .separator()
                    .services()
                    .separator()
                    .hide_with_text("隐藏 UltimateShell / Hide UltimateShell")
                    .hide_others_with_text("隐藏其他 / Hide Others")
                    .show_all_with_text("显示全部 / Show All")
                    .separator()
                    .quit_with_text("退出 UltimateShell / Quit")
                    .build()?;

                // 2. File Submenu
                let file_menu = SubmenuBuilder::new(app, "文件 / File")
                    .item(&MenuItemBuilder::with_id("menu-new-local-tab", "新建本地终端 / New Local Terminal").accelerator("CmdOrCtrl+T").build(app)?)
                    .item(&MenuItemBuilder::with_id("menu-new-host", "新建服务器连接... / New Host Connection...").accelerator("CmdOrCtrl+N").build(app)?)
                    .separator()
                    .item(&MenuItemBuilder::with_id("menu-close-tab", "关闭当前标签页 / Close Tab").accelerator("CmdOrCtrl+W").build(app)?)
                    .item(&MenuItemBuilder::with_id("menu-close-other-tabs", "关闭其他标签页 / Close Other Tabs").build(app)?)
                    .separator()
                    .close_window_with_text("关闭窗口 / Close Window")
                    .build()?;

                // 3. Edit Submenu
                let edit_menu = SubmenuBuilder::new(app, "编辑 / Edit")
                    .undo_with_text("撤销 / Undo")
                    .redo_with_text("重做 / Redo")
                    .separator()
                    .cut_with_text("剪切 / Cut")
                    .copy_with_text("复制 / Copy")
                    .paste_with_text("粘贴 / Paste")
                    .select_all_with_text("全选 / Select All")
                    .separator()
                    .item(&MenuItemBuilder::with_id("menu-clear-terminal", "清屏 / Clear Terminal").accelerator("CmdOrCtrl+K").build(app)?)
                    .build()?;

                // 4. View Submenu
                let view_menu = SubmenuBuilder::new(app, "查看 / View")
                    .item(&MenuItemBuilder::with_id("menu-toggle-sidebar", "切换服务器列表侧边栏 / Toggle Sidebar").accelerator("CmdOrCtrl+B").build(app)?)
                    .item(&MenuItemBuilder::with_id("menu-toggle-cmd-assistant", "切换命令库面板 / Toggle Command Library").accelerator("CmdOrCtrl+Shift+C").build(app)?)
                    .item(&MenuItemBuilder::with_id("menu-toggle-ops-drawer", "切换文件与运维抽屉 / Toggle Ops Drawer").accelerator("CmdOrCtrl+J").build(app)?)
                    .separator()
                    .item(&MenuItemBuilder::with_id("menu-zoom-in", "放大字体 / Zoom In").accelerator("CmdOrCtrl+=").build(app)?)
                    .item(&MenuItemBuilder::with_id("menu-zoom-out", "缩小字体 / Zoom Out").accelerator("CmdOrCtrl+-").build(app)?)
                    .item(&MenuItemBuilder::with_id("menu-zoom-reset", "重置字体大小 / Reset Zoom").accelerator("CmdOrCtrl+0").build(app)?)
                    .separator()
                    .fullscreen_with_text("切换全屏 / Toggle Full Screen")
                    .build()?;

                // 5. Session / Terminal Submenu
                let session_menu = SubmenuBuilder::new(app, "终端会话 / Session")
                    .item(&MenuItemBuilder::with_id("menu-duplicate-tab", "复制当前标签页 / Duplicate Session").accelerator("CmdOrCtrl+D").build(app)?)
                    .item(&MenuItemBuilder::with_id("menu-reconnect-session", "重新连接当前会话 / Reconnect Session").accelerator("CmdOrCtrl+R").build(app)?)
                    .separator()
                    .item(&MenuItemBuilder::with_id("menu-prev-tab", "上一标签页 / Previous Tab").accelerator("CmdOrCtrl+Shift+[").build(app)?)
                    .item(&MenuItemBuilder::with_id("menu-next-tab", "下一标签页 / Next Tab").accelerator("CmdOrCtrl+Shift+]").build(app)?)
                    .build()?;

                // 6. Window Submenu
                let window_menu = SubmenuBuilder::new(app, "窗口 / Window")
                    .minimize_with_text("最小化 / Minimize")
                    .maximize_with_text("缩放 / Zoom")
                    .separator()
                    .bring_all_to_front_with_text("前置全部窗口 / Bring All to Front")
                    .build()?;

                // 7. Help Submenu
                let help_menu = SubmenuBuilder::new(app, "帮助 / Help")
                    .item(&MenuItemBuilder::with_id("menu-help-shortcuts", "快捷键速查 / Keyboard Shortcuts").build(app)?)
                    .build()?;

                let menu_bar = MenuBuilder::new(app)
                    .items(&[
                        &app_menu,
                        &file_menu,
                        &edit_menu,
                        &view_menu,
                        &session_menu,
                        &window_menu,
                        &help_menu,
                    ])
                    .build()?;

                app.set_menu(menu_bar)?;
            }

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
            fs_list_dir,
            fs_read_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
