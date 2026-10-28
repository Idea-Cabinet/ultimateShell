use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Clone, Serialize)]
pub struct TransferProgressPayload {
    pub task_id: String,
    pub transferred: u64,
    pub total: u64,
    pub speed: u64, // bytes per second
}

#[derive(Clone, Serialize)]
pub struct TransferStatusPayload {
    pub task_id: String,
    pub status: String, // "transferring" | "completed" | "error" | "cancelled"
    pub error: Option<String>,
}

#[derive(Default, Clone)]
pub struct TransferState {
    pub cancels: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl TransferState {
    pub fn new() -> Self {
        Self {
            cancels: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn register(&self, task_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.cancels
            .lock()
            .unwrap()
            .insert(task_id.to_string(), Arc::clone(&flag));
        flag
    }

    pub fn cancel(&self, task_id: &str) -> bool {
        if let Some(flag) = self.cancels.lock().unwrap().get(task_id) {
            flag.store(true, Ordering::Relaxed);
            true
        } else {
            false
        }
    }

    pub fn remove(&self, task_id: &str) {
        self.cancels.lock().unwrap().remove(task_id);
    }
}
