use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn get_machine_fingerprint() -> String {
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                if line.contains("IOPlatformUUID") {
                    if let Some(pos) = line.find('=') {
                        let uuid = line[pos + 1..].trim().trim_matches('"');
                        if !uuid.is_empty() {
                            return uuid.to_string();
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(id) = fs::read_to_string("/etc/machine-id") {
            let trimmed = id.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }

    // Universal fallback: username + hostname
    let user = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "default_user".to_string());
    format!("ultimateshell-fingerprint-{}", user)
}

fn derive_key() -> Key<Aes256Gcm> {
    let fp = get_machine_fingerprint();
    let mut hasher = Sha256::new();
    hasher.update(b"ultimateshell-hardware-salt-2026-");
    hasher.update(fp.as_bytes());
    let hash = hasher.finalize();
    *Key::<Aes256Gcm>::from_slice(&hash)
}

pub fn encrypt_secret(plaintext: &str) -> Result<String, String> {
    let key = derive_key();
    let cipher = Aes256Gcm::new(&key);
    use aes_gcm::aead::rand_core::RngCore;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| e.to_string())?;

    // Combine nonce + ciphertext and base64-encode
    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(combined))
}

pub fn decrypt_secret(encoded: &str) -> Result<String, String> {
    use base64::Engine;
    let combined = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|e| e.to_string())?;

    if combined.len() < 12 + 16 {
        return Err("Ciphertext too short".to_string());
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let key = derive_key();
    let cipher = Aes256Gcm::new(&key);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext_bytes = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| e.to_string())?;

    String::from_utf8(plaintext_bytes).map_err(|e| e.to_string())
}

fn get_vault_path() -> PathBuf {
    let mut dir = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    dir.push(".ultimateshell");
    let _ = fs::create_dir_all(&dir);
    dir.push("credentials.json");
    dir
}

pub fn load_credentials() -> HashMap<String, String> {
    let path = get_vault_path();
    if !path.exists() {
        return HashMap::new();
    }
    match fs::read_to_string(&path) {
        Ok(c) => serde_json::from_str(&c).unwrap_or_default(),
        Err(_) => HashMap::new(),
    }
}

pub fn save_password(host_id: &str, password: &str) -> Result<(), String> {
    let mut creds = load_credentials();
    let encrypted = encrypt_secret(password)?;
    creds.insert(host_id.to_string(), encrypted);

    let path = get_vault_path();
    let json = serde_json::to_string_pretty(&creds).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn get_password(host_id: &str) -> Option<String> {
    let creds = load_credentials();
    let enc = creds.get(host_id)?;
    decrypt_secret(enc).ok()
}
