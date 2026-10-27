use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub group: Option<String>,
    pub description: Option<String>,
    pub identity_file: Option<String>,
}

fn get_storage_path() -> PathBuf {
    let mut dir = dirs_next().unwrap_or_else(|| PathBuf::from("."));
    dir.push(".ultimateshell");
    let _ = fs::create_dir_all(&dir);
    dir.push("hosts.json");
    dir
}

fn dirs_next() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

pub fn load_hosts() -> Vec<HostProfile> {
    let path = get_storage_path();
    if !path.exists() {
        return vec![];
    }
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => vec![],
    }
}

pub fn save_hosts(hosts: &[HostProfile]) -> Result<(), String> {
    let path = get_storage_path();
    let content = serde_json::to_string_pretty(hosts).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

pub fn import_from_finalshell() -> Result<Vec<HostProfile>, String> {
    let mut finalshell_conn_dir = dirs_next().ok_or("Cannot locate home directory")?;
    #[cfg(target_os = "macos")]
    {
        finalshell_conn_dir.push("Library");
        finalshell_conn_dir.push("FinalShell");
        finalshell_conn_dir.push("conn");
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("LOCALAPPDATA") {
            finalshell_conn_dir = PathBuf::from(appdata);
        } else {
            finalshell_conn_dir.push("AppData");
            finalshell_conn_dir.push("Local");
        }
        finalshell_conn_dir.push("finalshell");
        finalshell_conn_dir.push("conn");
    }
    #[cfg(target_os = "linux")]
    {
        finalshell_conn_dir.push(".finalshell");
        finalshell_conn_dir.push("conn");
    }

    if !finalshell_conn_dir.exists() {
        return Err(format!(
            "FinalShell 目录未找到: {}",
            finalshell_conn_dir.display()
        ));
    }

    let mut imported = Vec::new();
    let entries = fs::read_dir(&finalshell_conn_dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() && p.extension().map_or(false, |ext| ext == "json") {
            if let Ok(content) = fs::read_to_string(&p) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                    let host = v.get("host").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    if host.is_empty() {
                        continue;
                    }
                    let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    let name = v.get("name").and_then(|x| x.as_str()).unwrap_or(&host).to_string();
                    let port = v.get("port").and_then(|x| x.as_u64()).unwrap_or(22) as u16;
                    let username = v.get("user_name").and_then(|x| x.as_str()).unwrap_or("root").to_string();
                    let desc = v.get("description").and_then(|x| x.as_str()).map(|s| s.to_string());
                    let parent = v.get("parent_id").and_then(|x| x.as_str()).map(|s| {
                        if s == "root" || s.is_empty() {
                            "默认分组".to_string()
                        } else {
                            s.to_string()
                        }
                    });

                    imported.push(HostProfile {
                        id: if id.is_empty() { uuid::Uuid::new_v4().to_string() } else { id },
                        name,
                        host,
                        port,
                        username,
                        group: parent,
                        description: desc,
                        identity_file: None,
                    });
                }
            }
        }
    }

    // Merge with existing hosts
    let mut current = load_hosts();
    for item in &imported {
        if !current.iter().any(|h| h.id == item.id || (h.host == item.host && h.port == item.port && h.username == item.username)) {
            current.push(item.clone());
        }
    }
    save_hosts(&current)?;

    Ok(imported)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_import_finalshell() {
        let res = import_from_finalshell();
        assert!(res.is_ok(), "Import failed: {:?}", res.err());
        let hosts = res.unwrap();
        println!("Imported {} hosts from FinalShell", hosts.len());
        assert!(!hosts.is_empty(), "Should import at least 1 host");
    }
}

