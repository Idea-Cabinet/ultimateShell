mod hosts;
mod pty;

use hosts::{HostProfile, import_from_finalshell, load_hosts, save_hosts};
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
fn get_hosts() -> Vec<HostProfile> {
    load_hosts()
}

#[tauri::command]
fn save_host(mut host: HostProfile) -> Result<HostProfile, String> {
    if host.id.trim().is_empty() {
        host.id = uuid::Uuid::new_v4().to_string();
    }
    let mut current = load_hosts();
    if let Some(pos) = current.iter().position(|h| h.id == host.id) {
        current[pos] = host.clone();
    } else {
        current.push(host.clone());
    }
    save_hosts(&current)?;
    Ok(host)
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
            get_hosts,
            save_host,
            delete_host,
            import_finalshell,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
