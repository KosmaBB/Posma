//! The closed, cross-OS catalog of privileged operations (Access_plan.md
//! §2/§4). This is the ONLY vocabulary any broker on any OS understands —
//! there is deliberately no "run this command as root" escape hatch, and
//! adding a capability means adding a variant here plus an implementation
//! in the OS brokers that can honour it, never widening an existing one.
//!
//! An operation is listed once some module calls it. On an OS whose broker
//! does not implement it, it still parses and gets a truthful
//! `not_supported` answer rather than an opaque protocol error.

use serde::{Deserialize, Serialize};

/// Which package/software backend an operation targets. Kept as one shared
/// enum rather than per-OS strings so the frontend speaks one vocabulary
/// everywhere; each broker rejects the sources it can't serve.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PkgSource {
    // Linux
    Apt,
    Snap,
    Flatpak,
    Pacman,
    Dnf,
    Zypper,
    // Windows
    Winget,
}

/// Size- vs age-based trimming (journald `--vacuum-size`/`--vacuum-time`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrimMode {
    Size,
    Time,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    // ---------------------------------------------------------- fs-system
    /// Delete files that live outside the user's scope. Each OS broker
    /// applies its OWN whitelist — the caller never gets to widen it.
    CleanSystemPaths { paths: Vec<String> },
    /// Backup-rotate-write-verify a root-owned config file. `keep_backups`
    /// is the retention count; the broker takes a timestamped copy first
    /// and rolls back if post-write verification fails.
    WriteSystemFile {
        path: String,
        content: String,
        keep_backups: u64,
    },
    /// Restore one previously-taken backup of a system file.
    RestoreSystemFileBackup { path: String, filename: String, keep_backups: u64 },
    /// Recursively copy a user-picked directory into a root-owned location
    /// (GRUB themes today; boot/branding assets on other OSes later).
    InstallDirectory {
        source_dir: String,
        dest_name: String,
        /// Config written through the same backup pipeline once the copy
        /// lands, so "install + activate" stays one atomic-feeling action.
        activate_content: Option<String>,
        activate_path: Option<String>,
        keep_backups: u64,
    },

    // ----------------------------------------------------------- packages
    /// Remove an installed package/application.
    PkgRemove { source: PkgSource, id: String },
    /// Remove one specific retained revision (snap's rollback copies).
    PkgRemoveRevision { source: PkgSource, id: String, revision: u64 },
    /// Empty a package manager's download cache.
    PkgCacheClean { source: PkgSource },
    /// Remove packages the manager considers orphaned.
    PkgAutoremove { source: PkgSource },
    /// Apply pending updates for one package (or all, when `id` is None).
    PkgUpgrade { source: PkgSource, id: Option<String> },

    // ----------------------------------------------------------- services
    /// Switch a Windows service a profile lists off (disabled, stopped) or
    /// back to its Windows default (`windows_services`).
    ServiceSetEnabled { name: String, enabled: bool },

    // --------------------------------------------------------- boot/kernel
    /// Remove an installed kernel package. Brokers re-derive the running
    /// and newest kernel themselves and refuse either — never trusting the
    /// caller's idea of which is safe.
    RemoveKernel { package: String },
    /// Trim system logs (journald, macOS unified log, Windows event logs).
    TrimSystemLogs { mode: TrimMode, value: u64 },
    /// Enumerate bootloader menu entries (needs root to read the config).
    ReadBootEntries,
    /// Set the default entry and the timeout of a loader that reads its
    /// own config at boot (Limine, systemd-boot, rEFInd). The broker edits
    /// those two lines itself, so no file content ever comes from the
    /// caller. `None` leaves that setting as it is.
    SetBootOptions { default_entry: Option<String>, timeout: Option<String>, keep_backups: u64 },

    // ---------------------------------------------------------- disk/SMART
    /// Read S.M.A.R.T. health for a device with the privileges raw
    /// passthrough needs.
    SmartRead { device: String },

    // -------------------------------------------------- Windows-specific
    /// Create a System Restore point before a risky operation
    /// (Access_plan.md makes this mandatory before critical Windows ops).
    CreateRestorePoint { description: String },
    /// DISM's report on the component store: its size and whether a
    /// cleanup is worth it (WinSxS module, the preview before cleaning).
    AnalyzeComponentStore,
    /// DISM component-store cleanup (WinSxS module).
    ComponentStoreCleanup,

    // ---------------------------------------------------- macOS-specific
    /// Delete local Time Machine snapshots (tmutil).
    DeleteLocalSnapshots { keep_latest: bool },

    // ------------------------------------------------------------- meta
    /// Which operations this broker actually implements — lets the
    /// frontend disable unavailable actions instead of discovering it by
    /// failing.
    Capabilities,
}
