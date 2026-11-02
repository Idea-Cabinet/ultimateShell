//! AI-only leases. The terminal/file pools never own these connections.
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use crate::pty::SpawnOptions;
use sha2::{Digest, Sha256};

pub const IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const SWEEP_INTERVAL: Duration = Duration::from_secs(15);

type Entries = Mutex<HashMap<String, Arc<Entry>>>;
struct Entry {
    session: Mutex<Option<ssh2::Session>>,
    last_used: Mutex<Instant>,
}

#[derive(Clone)]
pub struct AgentConnections {
    entries: Arc<Entries>,
    idle_timeout: Duration,
}

pub struct ConnectionLease { entry: Arc<Entry> }
impl ConnectionLease {
    pub fn lock(&self) -> Result<MutexGuard<'_, Option<ssh2::Session>>, String> {
        self.entry.session.lock().map_err(|_| "AI SSH 连接锁异常".into())
    }
}
impl Drop for ConnectionLease {
    fn drop(&mut self) {
        if let Ok(mut used) = self.entry.last_used.lock() { *used = Instant::now(); }
    }
}

impl AgentConnections {
    pub fn new() -> Self {
        let pool = Self { entries: Arc::new(Mutex::new(HashMap::new())), idle_timeout: IDLE_TIMEOUT };
        let weak = Arc::downgrade(&pool.entries);
        std::thread::spawn(move || loop {
            std::thread::sleep(SWEEP_INTERVAL);
            let Some(entries) = weak.upgrade() else { break };
            reap(&entries, IDLE_TIMEOUT, Instant::now());
        });
        pool
    }
    pub fn acquire(&self, opts: &SpawnOptions) -> Result<ConnectionLease, String> {
        self.acquire_key(&connection_key(opts)?)
    }
    fn acquire_key(&self, key: &str) -> Result<ConnectionLease, String> {
        reap(&self.entries, self.idle_timeout, Instant::now());
        let mut entries = self.entries.lock().map_err(|_| "AI SSH 连接池异常")?;
        let entry = entries.entry(key.to_owned()).or_insert_with(|| Arc::new(Entry {
            session: Mutex::new(None), last_used: Mutex::new(Instant::now()),
        })).clone();
        Ok(ConnectionLease { entry })
    }
    pub fn clear(&self) {
        // Active leases keep their transport alive until their request finishes.
        if let Ok(mut entries) = self.entries.lock() {
            let removed: Vec<_> = entries.drain().map(|(_, entry)| entry).collect();
            drop(entries);
            drop(removed);
        }
    }
    #[cfg(test)]
    fn count(&self) -> usize {
        self.entries.lock().map(|entries| entries.len()).unwrap_or(0)
    }
}

fn connection_key(opts: &SpawnOptions) -> Result<String, String> {
    // Ignore terminal ID and window size, but separate every connection-affecting setting.
    // Hash the key so proxy credentials are never part of a display/log identifier.
    let bytes = serde_json::to_vec(&(
        &opts.host_id, &opts.host, opts.port, &opts.username, &opts.identity_file,
        &opts.proxy_type, &opts.jump_host_id, &opts.proxy_url,
    )).map_err(|e| e.to_string())?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn reap(entries: &Entries, timeout: Duration, now: Instant) -> usize {
    let Ok(mut map) = entries.lock() else { return 0 };
    let expired: Vec<_> = map.iter().filter_map(|(key, entry)| {
        // A lease includes requests waiting for the per-server lock, not only executing ones.
        let idle = Arc::strong_count(entry) == 1 && entry.last_used.lock().map(|used|
            now.saturating_duration_since(*used) >= timeout).unwrap_or(false);
        idle.then(|| key.clone())
    }).collect();
    let removed: Vec<_> = expired.iter().filter_map(|key| map.remove(key)).collect();
    drop(map);
    let count = removed.len();
    drop(removed);
    count
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pool() -> AgentConnections {
        AgentConnections { entries: Arc::new(Mutex::new(HashMap::new())), idle_timeout: IDLE_TIMEOUT }
    }
    #[test]
    fn idle_connections_expire_without_another_request() {
        let pool = pool();
        let first = pool.acquire_key("host").unwrap();
        let original = Arc::downgrade(&first.entry);
        drop(first);
        let last = *pool.entries.lock().unwrap()["host"].last_used.lock().unwrap();
        assert_eq!(reap(&pool.entries, IDLE_TIMEOUT, last + IDLE_TIMEOUT - Duration::from_secs(1)), 0);
        assert_eq!(reap(&pool.entries, IDLE_TIMEOUT, last + IDLE_TIMEOUT), 1);
        assert!(original.upgrade().is_none());
        assert_eq!(pool.count(), 0);
    }
    #[test]
    fn active_and_queued_requests_survive_idle_sweep_and_shutdown() {
        let pool = pool();
        let active = pool.acquire_key("host").unwrap();
        let waiting = pool.acquire_key("host").unwrap();
        assert!(Arc::ptr_eq(&active.entry, &waiting.entry));
        assert_eq!(reap(&pool.entries, IDLE_TIMEOUT, Instant::now() + IDLE_TIMEOUT * 2), 0);
        let weak = Arc::downgrade(&active.entry);
        pool.clear();
        assert_eq!(pool.count(), 0);
        drop(active); assert!(weak.upgrade().is_some());
        drop(waiting); assert!(weak.upgrade().is_none());
    }
    #[test]
    fn expiry_releases_transport_but_never_closes_active_transport() {
        use std::io::Read;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let client = std::net::TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (mut peer, _) = listener.accept().unwrap();
        peer.set_read_timeout(Some(Duration::from_millis(100))).unwrap();
        let pool = pool();
        let lease = pool.acquire_key("host").unwrap();
        let mut session = ssh2::Session::new().unwrap();
        session.set_tcp_stream(client);
        *lease.lock().unwrap() = Some(session);
        assert_eq!(reap(&pool.entries, IDLE_TIMEOUT, Instant::now() + IDLE_TIMEOUT * 2), 0);
        assert!(peer.read(&mut [0u8; 1]).is_err());
        drop(lease);
        assert_eq!(reap(&pool.entries, IDLE_TIMEOUT, Instant::now() + IDLE_TIMEOUT * 2), 1);
        assert_eq!(peer.read(&mut [0u8; 1]).unwrap(), 0);
    }

    #[test]
    fn idle_clock_starts_after_request_finishes() {
        let pool = pool();
        let active = pool.acquire_key("host").unwrap();
        *active.entry.last_used.lock().unwrap() = Instant::now() - IDLE_TIMEOUT * 2;
        drop(active);
        assert_eq!(reap(&pool.entries, IDLE_TIMEOUT, Instant::now()), 0);
    }
    #[test]
    fn connection_settings_are_isolated_from_terminal_ids() {
        let mut opts: SpawnOptions = serde_json::from_value(serde_json::json!({
            "session_id":"terminal-1", "is_local":false,"host":"example.invalid","port":22,"username":"user"
        })).unwrap();
        let first = connection_key(&opts).unwrap();
        opts.session_id = "terminal-2".into(); opts.cols = Some(200);
        assert_eq!(first, connection_key(&opts).unwrap());
        opts.username = Some("another".into());
        assert_ne!(first, connection_key(&opts).unwrap());
        let a = pool(); let b = pool();
        let one = a.acquire(&opts).unwrap(); let two = b.acquire(&opts).unwrap();
        assert!(!Arc::ptr_eq(&one.entry, &two.entry));
    }
}
