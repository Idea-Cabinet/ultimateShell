mod hosts;
mod pty;
mod vault;

use hosts::{import_from_finalshell, load_hosts, save_hosts, HostProfile};
use pty::{PtyManager, SpawnOptions};
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
fn pty_close(pty_mgr: State<PtyManager>, session_id: String) -> Result<(), String> {
    pty_mgr.close(&session_id)
}

#[tauri::command]
fn get_session_stats(pty_mgr: State<PtyManager>, session_id: String) -> (String, usize) {
    pty_mgr.get_cwd_stats(&session_id)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_mgr = PtyManager::new();

    tauri::Builder::default()
        .manage(pty_mgr)
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close,
            get_session_stats,
            get_hosts,
            save_host,
            update_host_access_time,
            delete_host,
            import_finalshell,
            save_host_password,
            get_host_password,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
