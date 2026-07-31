//! Permission registry (Access_plan.md §6 step 2). Tracks the grant state
//! of each capability across app restarts, persisted to `permissions.json`
//! in the app's data dir.
//!
//! Capabilities with `Elevation::None` are auto-granted on first request —
//! there's nothing to ask for. Capabilities that need elevation are granted
//! here too (recording consent) once the Linux broker (§6 step 3, see
//! `broker.rs`) exists for this platform; the actual `pkexec` prompt and
//! any real failure happen at the point a module performs the privileged
//! operation, not at grant time. On platforms without a broker yet, this
//! stays an honest "not implemented" error rather than reaching for a
//! per-module pkexec shortcut.
//!
//! `niepotrzebne` vs `wymagane-nienadane` (§5) is deliberately NOT tracked
//! here: that distinction depends on which modules are currently installed,
//! and installed-module state lives in the frontend's localStorage, not in
//! Rust. The frontend derives it by combining `get_permissions` with its own
//! installed-module capability list.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::capabilities::{CapabilityId, Elevation, CAPABILITIES};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PermissionStatus {
    Granted,
    GrantedSession,
    Denied,
}

#[derive(Serialize)]
pub struct PermissionEntry {
    pub id: CapabilityId,
    pub elevation: Elevation,
    pub manual_only: bool,
    pub status: Option<PermissionStatus>,
}

/// Only `Granted`/`Denied` are ever written here — `GrantedSession` is a
/// per-run grant (Wybiórczy mode, §5) and must not survive a restart.
#[derive(Default, Serialize, Deserialize)]
struct PersistedState {
    entries: Vec<(CapabilityId, PermissionStatus)>,
}

pub struct PermissionRegistry {
    state: Mutex<HashMap<CapabilityId, PermissionStatus>>,
    file_path: PathBuf,
}

impl PermissionRegistry {
    pub fn load(file_path: PathBuf) -> Self {
        let state = fs::read_to_string(&file_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<PersistedState>(&raw).ok())
            .map(|persisted| persisted.entries.into_iter().collect())
            .unwrap_or_default();
        Self { state: Mutex::new(state), file_path }
    }

    fn persist(&self, state: &HashMap<CapabilityId, PermissionStatus>) {
        let entries = state
            .iter()
            .filter(|(_, status)| **status != PermissionStatus::GrantedSession)
            .map(|(id, status)| (*id, *status))
            .collect();
        if let Some(parent) = self.file_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&PersistedState { entries }) {
            let _ = fs::write(&self.file_path, json);
        }
    }

    pub async fn snapshot(&self) -> Vec<PermissionEntry> {
        let state = self.state.lock().await;
        CAPABILITIES
            .iter()
            .map(|def| PermissionEntry {
                id: def.id,
                elevation: def.elevation,
                manual_only: def.manual_only,
                status: state.get(&def.id).copied(),
            })
            .collect()
    }

    /// Grants `capability` if it needs no elevation, or if a broker
    /// already granted it (not possible yet — see module doc comment).
    /// Returns the resulting status, or an error naming exactly what's
    /// missing rather than silently doing nothing.
    pub async fn request(&self, capability: CapabilityId) -> Result<PermissionStatus, String> {
        let mut state = self.state.lock().await;
        if let Some(status @ (PermissionStatus::Granted | PermissionStatus::GrantedSession)) =
            state.get(&capability)
        {
            return Ok(*status);
        }

        let elevation = CAPABILITIES
            .iter()
            .find(|def| def.id == capability)
            .map(|def| def.elevation)
            .unwrap_or(Elevation::None);

        if elevation == Elevation::None || cfg!(target_os = "linux") {
            state.insert(capability, PermissionStatus::Granted);
            self.persist(&state);
            return Ok(PermissionStatus::Granted);
        }

        Err(format!(
            "{capability:?} wymaga podniesienia uprawnień — broker jest na razie zaimplementowany tylko dla Linuksa (Access_plan.md §6 krok 3)"
        ))
    }

    pub async fn deny(&self, capability: CapabilityId) {
        let mut state = self.state.lock().await;
        state.insert(capability, PermissionStatus::Denied);
        self.persist(&state);
    }

    /// Gate for any command that's about to perform a real privileged
    /// operation: fails closed unless the capability was already granted
    /// via `request()`. Manifest-declaration checking (Access_plan.md §2 —
    /// "rdzeń sprawdza manifest modułu") isn't wired up yet since nothing
    /// in Rust reads module.json at runtime; this is the layer that exists
    /// today.
    pub async fn require(&self, capability: CapabilityId) -> Result<(), String> {
        let state = self.state.lock().await;
        match state.get(&capability) {
            Some(PermissionStatus::Granted | PermissionStatus::GrantedSession) => Ok(()),
            _ => Err(format!(
                "{capability:?} nie zostało nadane — wywołaj request_permission przed użyciem"
            )),
        }
    }
}
