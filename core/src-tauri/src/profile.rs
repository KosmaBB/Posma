//! What the user corrected about this Linux system — package family,
//! desktop, boot loader — persisted to `system-profile.json` beside the
//! permissions. Detection itself lives in the `distro` crate; this only
//! keeps the answer and hands it to every module through its environment,
//! so no module can act on detection the user already said was wrong.
//!
//! The broker never sees it: it is not started from here, and which
//! package manager runs as root stays a fact about the machine (see
//! `distro::manager_preferring`).

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// `None` follows detection.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProfileOverrides {
    #[serde(default)]
    pub pkg_manager: Option<String>,
    #[serde(default)]
    pub desktop: Option<String>,
    #[serde(default)]
    pub bootloader: Option<String>,
}

impl ProfileOverrides {
    /// Each value must be one `distro` knows, so a typo is refused here
    /// rather than silently ignored by every module.
    fn validate(&self) -> Result<(), String> {
        let check = |value: &Option<String>, allowed: &[&str], what: &str| match value {
            Some(v) if !allowed.contains(&v.as_str()) => Err(format!("nieznana wartość „{v}” dla: {what}")),
            _ => Ok(()),
        };
        check(&self.pkg_manager, &["apt", "pacman", "dnf", "zypper"], "menedżer pakietów")?;
        check(&self.desktop, distro::DESKTOPS, "środowisko graficzne")?;
        check(&self.bootloader, distro::BOOTLOADERS, "program rozruchowy")
    }

    pub fn env(&self) -> Vec<(&'static str, String)> {
        [("POSMA_PKG_MANAGER", &self.pkg_manager), ("POSMA_DESKTOP", &self.desktop), ("POSMA_BOOTLOADER", &self.bootloader)]
            .into_iter()
            .filter_map(|(var, value)| value.clone().map(|v| (var, v)))
            .collect()
    }
}

pub struct ProfileStore {
    file_path: PathBuf,
    current: Mutex<ProfileOverrides>,
}

impl ProfileStore {
    /// A missing or unreadable file is no correction at all.
    pub fn load(file_path: PathBuf) -> Self {
        let current = fs::read_to_string(&file_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<ProfileOverrides>(&raw).ok())
            .filter(|o| o.validate().is_ok())
            .unwrap_or_default();
        ProfileStore { file_path, current: Mutex::new(current) }
    }

    pub fn get(&self) -> ProfileOverrides {
        self.current.lock().map(|c| c.clone()).unwrap_or_default()
    }

    pub fn set(&self, overrides: ProfileOverrides) -> Result<(), String> {
        overrides.validate()?;
        if let Some(parent) = self.file_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(&overrides).map_err(|e| e.to_string())?;
        fs::write(&self.file_path, json).map_err(|e| format!("nie udało się zapisać profilu systemu: {e}"))?;
        *self.current.lock().map_err(|e| e.to_string())? = overrides;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_correction_survives_a_restart_and_reaches_the_environment() {
        let path = std::env::temp_dir().join(format!("posma-profile-test-{}.json", std::process::id()));
        let _ = fs::remove_file(&path);
        let wanted = ProfileOverrides { desktop: Some("xfce".into()), bootloader: Some("grub".into()), ..Default::default() };

        ProfileStore::load(path.clone()).set(wanted.clone()).unwrap();
        let reloaded = ProfileStore::load(path.clone()).get();
        let _ = fs::remove_file(&path);

        assert_eq!(reloaded, wanted);
        assert_eq!(reloaded.env(), vec![("POSMA_DESKTOP", "xfce".to_string()), ("POSMA_BOOTLOADER", "grub".to_string())]);
    }

    #[test]
    fn values_no_module_knows_are_refused() {
        let store = ProfileStore::load(std::env::temp_dir().join("posma-profile-never-written.json"));
        let bad = ProfileOverrides { desktop: Some("kde".into()), ..Default::default() };
        assert!(store.set(bad).unwrap_err().contains("kde"));
        assert_eq!(store.get(), ProfileOverrides::default());
    }
}
