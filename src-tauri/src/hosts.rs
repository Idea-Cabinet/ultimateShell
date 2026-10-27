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

