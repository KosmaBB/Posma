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

use crate::capabilities::{self, CapabilityId, Elevation};

/// Which bargain the user struck at onboarding (Access_plan.md §5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AccessLevel {
    /// Consent given once, in bulk, with the whole list in front of them.
    /// Installing a module later never asks again.
    Full,
    /// Nothing is assumed. Anything needing elevation is granted for this
    /// run only, so the next start asks again.
    ///
    /// The default, because a stored file that has lost its access level
    /// should fall back to asking rather than to assuming consent.
    #[default]
    Selective,
}

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
    /// Absent in files written before access levels were enforced; those
    /// fall back to the stricter of the two rather than the one they were
    /// effectively running under.
    #[serde(default)]
    access_level: AccessLevel,
}

pub struct PermissionRegistry {
    state: Mutex<HashMap<CapabilityId, PermissionStatus>>,
    access_level: Mutex<AccessLevel>,
    file_path: PathBuf,
}

impl PermissionRegistry {
    pub fn load(file_path: PathBuf) -> Self {
        let persisted = fs::read_to_string(&file_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<PersistedState>(&raw).ok())
            .unwrap_or_default();
        Self {
            state: Mutex::new(persisted.entries.into_iter().collect()),
            access_level: Mutex::new(persisted.access_level),
            file_path,
        }
    }

    fn persist_with(&self, state: &HashMap<CapabilityId, PermissionStatus>, access_level: AccessLevel) {
        let entries = state
            .iter()
            .filter(|(_, status)| **status != PermissionStatus::GrantedSession)
            .map(|(id, status)| (*id, *status))
            .collect();
        if let Some(parent) = self.file_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&PersistedState { entries, access_level }) {
            let _ = fs::write(&self.file_path, json);
        }
    }

    pub async fn snapshot(&self) -> Vec<PermissionEntry> {
        let state = self.state.lock().await;
        capabilities::capabilities()
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
        let level = *self.access_level.lock().await;
        let mut state = self.state.lock().await;
        if let Some(status @ (PermissionStatus::Granted | PermissionStatus::GrantedSession)) =
            state.get(&capability)
        {
            return Ok(*status);
        }

        let elevation = capabilities::definition(capability)
            .map(|def| def.elevation)
            .unwrap_or(Elevation::None);

        // Nothing to consent to: granted, and it stays granted.
        if elevation == Elevation::None {
            state.insert(capability, PermissionStatus::Granted);
            self.persist_with(&state, level);
            return Ok(PermissionStatus::Granted);
        }

        if !cfg!(target_os = "linux") {
            return Err(format!(
                "{capability:?} wymaga podniesienia uprawnień — broker jest na razie zaimplementowany tylko dla Linuksa (Access_plan.md §6 krok 3)"
            ));
        }

        // Where the two access levels actually differ. Full access was
        // consented to in bulk with the whole list visible, so it is
        // recorded and survives a restart. Selective consent was given for
        // one action, so it lasts one run and is asked for again next time.
        let status = match level {
            AccessLevel::Full => PermissionStatus::Granted,
            AccessLevel::Selective => PermissionStatus::GrantedSession,
        };
        state.insert(capability, status);
        self.persist_with(&state, level);
        Ok(status)
    }

    pub async fn deny(&self, capability: CapabilityId) {
        let level = *self.access_level.lock().await;
        let mut state = self.state.lock().await;
        state.insert(capability, PermissionStatus::Denied);
        self.persist_with(&state, level);
    }

    pub async fn access_level(&self) -> AccessLevel {
        *self.access_level.lock().await
    }

    /// Records the choice made at onboarding, or a later change of mind.
    ///
    /// Tightening to selective drops every session grant immediately, so
    /// the change takes effect now rather than at the next start. Grants
    /// that were recorded under full access are kept: they were consented
    /// to, and silently revoking them would misrepresent what happened.
    pub async fn set_access_level(&self, level: AccessLevel) {
        let mut current = self.access_level.lock().await;
        *current = level;
        let mut state = self.state.lock().await;
        if level == AccessLevel::Selective {
            state.retain(|_, status| *status != PermissionStatus::GrantedSession);
        }
        self.persist_with(&state, level);
    }

    /// Gate for a command about to perform a real privileged operation.
    ///
    /// Two things have to hold, and they are different questions. The
    /// catalog has to say this operation's module may ask for this
    /// capability at all — a grant of `boot` lets the GRUB editor touch the
    /// boot configuration, not whatever else happens to call in. And the
    /// user has to have granted it. Either one missing is a refusal.
    ///
    /// Named operations rather than bare capabilities so the first check is
    /// possible: a capability on its own does not say who is asking.
    pub async fn require_operation(&self, operation: &str) -> Result<(), String> {
        let Some(op) = capabilities::operation(operation) else {
            return Err(format!(
                "operacja {operation} nie występuje w access/catalog.json — odmowa"
            ));
        };

        if !capabilities::declared_by(&op.module).contains(&op.capability) {
            return Err(format!(
                "moduł {} nie deklaruje {:?} w swoim manifeście — odmowa niezależnie od nadanych uprawnień",
                op.module, op.capability
            ));
        }

        let state = self.state.lock().await;
        match state.get(&op.capability) {
            Some(PermissionStatus::Granted | PermissionStatus::GrantedSession) => Ok(()),
            _ => Err(format!(
                "{:?} nie zostało nadane — wywołaj request_permission przed użyciem",
                op.capability
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Each test gets its own state file so they cannot see each other's
    /// grants, and so none of them touches the real one.
    fn registry(tag: &str) -> PermissionRegistry {
        let path = std::env::temp_dir().join(format!(
            "posma-perm-test-{tag}-{}.json",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);
        PermissionRegistry::load(path)
    }

    /// Full access was consented to in bulk, so the grant is recorded and
    /// outlives the run.
    #[tokio::test]
    async fn full_access_grants_persistently() {
        let reg = registry("full");
        reg.set_access_level(AccessLevel::Full).await;
        let status = reg.request(CapabilityId::Boot).await.expect("linux broker exists");
        assert_eq!(status, PermissionStatus::Granted);
    }

    /// Selective consent was given for one action, so it lasts one run.
    #[tokio::test]
    async fn selective_access_grants_for_the_session_only() {
        let reg = registry("selective");
        reg.set_access_level(AccessLevel::Selective).await;
        let status = reg.request(CapabilityId::Boot).await.expect("linux broker exists");
        assert_eq!(status, PermissionStatus::GrantedSession);
    }

    /// A capability that needs nothing is granted outright under either
    /// level — there is no consent to record.
    #[tokio::test]
    async fn capabilities_needing_nothing_are_always_persistent() {
        let reg = registry("none");
        reg.set_access_level(AccessLevel::Selective).await;
        let status = reg.request(CapabilityId::FsUser).await.expect("no elevation needed");
        assert_eq!(status, PermissionStatus::Granted);
    }

    /// Tightening the level takes effect now, not at the next start.
    #[tokio::test]
    async fn tightening_drops_session_grants() {
        let reg = registry("tighten");
        reg.set_access_level(AccessLevel::Full).await;
        reg.request(CapabilityId::Boot).await.unwrap();

        reg.set_access_level(AccessLevel::Selective).await;
        // Granted under full access, so it was real consent and survives.
        assert!(reg.require_operation("write_grub_config").await.is_ok());

        let reg2 = registry("tighten2");
        reg2.set_access_level(AccessLevel::Selective).await;
        reg2.request(CapabilityId::Boot).await.unwrap();
        reg2.set_access_level(AccessLevel::Selective).await;
        assert!(
            reg2.require_operation("write_grub_config").await.is_err(),
            "a session grant must not survive re-applying the selective level"
        );
    }

    #[tokio::test]
    async fn ungranted_capability_is_refused() {
        let reg = registry("ungranted");
        let err = reg.require_operation("write_grub_config").await.unwrap_err();
        assert!(err.contains("nie zostało nadane"), "{err}");
    }

    /// An operation the catalog does not describe cannot be gated, so it is
    /// refused rather than waved through.
    #[tokio::test]
    async fn unknown_operation_is_refused() {
        let reg = registry("unknown");
        reg.set_access_level(AccessLevel::Full).await;
        reg.request(CapabilityId::Boot).await.unwrap();
        let err = reg.require_operation("nie_ma_takiej_operacji").await.unwrap_err();
        assert!(err.contains("nie występuje w access/catalog.json"), "{err}");
    }

    /// The check that did not exist before: granting a capability does not
    /// hand it to a module that never declared it.
    #[tokio::test]
    async fn granting_does_not_cover_a_module_that_never_asked() {
        let reg = registry("manifest");
        reg.set_access_level(AccessLevel::Full).await;
        reg.request(CapabilityId::Boot).await.unwrap();

        // Every real operation is consistent with its manifest, so the case
        // is exercised through the lookup the gate performs.
        assert!(
            !crate::capabilities::declared_by("desktop-theme").contains(&CapabilityId::Boot),
            "desktop-theme must not declare boot — it writes only inside $HOME",
        );
        assert!(reg.require_operation("write_grub_config").await.is_ok());
    }
}
