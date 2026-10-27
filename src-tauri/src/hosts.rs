use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

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
    pub create_time: Option<u64>,
    pub access_time: Option<u64>,
    pub has_password: Option<bool>,
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
    // 1. Check if the user's dedicated parser script exists: /Users/mebius/Desktop/idea/finalshell_parse_all.js
    let custom_script = PathBuf::from("/Users/mebius/Desktop/idea/finalshell_parse_all.js");
    if custom_script.exists() {
        if let Ok(output) = Command::new("node")
            .arg(&custom_script)
            .args(["--json", "--current-only"])
            .output()
        {
            if output.status.success() {
                if let Ok(text) = String::from_utf8(output.stdout) {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                        if let Some(conns) = v.get("connections").and_then(|c| c.as_array()) {
                            let mut imported = Vec::new();
                            for item in conns {
                                let host = item.get("host").and_then(|x| x.as_str()).unwrap_or("").to_string();
                                if host.is_empty() {
                                    continue;
                                }
                                let id = item.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                                let name = item.get("name").and_then(|x| x.as_str()).unwrap_or(&host).to_string();
                                let port = item.get("port").and_then(|x| x.as_u64()).unwrap_or(22) as u16;
                                let username = item.get("user_name").and_then(|x| x.as_str()).unwrap_or("root").to_string();
                                let desc = item.get("description").and_then(|x| x.as_str()).map(|s| s.to_string());
                                let parent = item.get("group").or_else(|| item.get("parent_id")).and_then(|x| x.as_str()).map(|s| {
                                    if s == "root" || s.is_empty() {
                                        "默认分组".to_string()
                                    } else {
                                        s.to_string()
                                    }
                                });
                                let create_time = item.get("create_time").and_then(|x| x.as_u64());
                                let access_time = item.get("access_time").and_then(|x| x.as_u64());
                                let password_plain = item.get("password_plain").and_then(|x| x.as_str()).unwrap_or("");

                                let host_id = if id.is_empty() { uuid::Uuid::new_v4().to_string() } else { id };

                                // Save decrypted password into machine hardware-encrypted vault
                                if !password_plain.is_empty() {
                                    let _ = crate::vault::save_password(&host_id, password_plain);
                                }

                                imported.push(HostProfile {
                                    id: host_id,
                                    name,
                                    host,
                                    port,
                                    username,
                                    group: parent,
                                    description: desc,
                                    identity_file: None,
                                    create_time,
                                    access_time,
                                    has_password: Some(!password_plain.is_empty()),
                                });
                            }

                            // Merge into current hosts
                            let mut current = load_hosts();
                            for item in &imported {
                                if let Some(pos) = current.iter().position(|h| h.id == item.id) {
                                    current[pos] = item.clone();
                                } else {
                                    current.push(item.clone());
                                }
                            }
                            save_hosts(&current)?;
                            return Ok(imported);
                        }
                    }
                }
            }
        }
    }

    // Fallback: direct JSON directory scanning
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
                    let create_time = v.get("create_time").and_then(|x| x.as_u64());
                    let access_time = v.get("access_time").and_then(|x| x.as_u64());

                    imported.push(HostProfile {
                        id: if id.is_empty() { uuid::Uuid::new_v4().to_string() } else { id },
                        name,
                        host,
                        port,
                        username,
                        group: parent,
                        description: desc,
                        identity_file: None,
                        create_time,
                        access_time,
                        has_password: None,
                    });
                }
            }
        }
    }

    let mut current = load_hosts();
    for item in &imported {
        if !current.iter().any(|h| h.id == item.id) {
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
    fn test_import_with_passwords() {
        let res = import_from_finalshell();
        assert!(res.is_ok(), "Import failed: {:?}", res.err());
        let hosts = res.unwrap();
        println!("Imported {} hosts with script parser!", hosts.len());
        let creds = crate::vault::load_credentials();
        println!("Saved {} encrypted passwords in hardware vault!", creds.len());
        assert!(!creds.is_empty(), "Should have saved encrypted passwords");
    }
}

