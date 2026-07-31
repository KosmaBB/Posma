//! Privileged Linux broker (Access_plan.md §4 / §6 step 3).
//!
//! All protocol, dispatch, validation, backup/rollback and transport logic
//! lives in the shared `broker-common` crate — this binary is only the
//! Linux-specific part: which catalogued operations it can honour, and how.
//! Operations it doesn't implement are answered honestly by the trait's
//! defaults rather than failing at the protocol level.
//!
//! Runs as root (via `pkexec`, or as the installed systemd service), so it
//! re-validates every request itself rather than trusting whatever core
//! already checked — the same defense-in-depth rule the unprivileged
//! sidecars apply to their own whitelists.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use broker_common::guards::{self, is_safe_name, is_safe_package_id};
use broker_common::ops::{PkgSource, TrimMode};
use broker_common::result::{BootEntries, CleanResult, ExecResult, TextResult};
use broker_common::{run_capture, run_verify, Broker};

const DEFAULT_SOCKET_PATH: &str = "/run/posma-broker.sock";
const DEFAULT_OWNER_UID_FILE: &str = "/etc/posma/broker-owner-uid";
const GRUB_DEFAULT_PATH: &str = "/etc/default/grub";
const GRUB_CFG_PATH: &str = "/boot/grub/grub.cfg";
const GRUB_THEMES_DIR: &str = "/boot/grub/themes";
/// Where this module wrote backups before the broker was generalized AND
/// before the POSAM->POSMA rename. Spelled with the old name deliberately:
/// this is the directory that physically exists on machines that ran those
/// builds. Read-only, so pre-rename backups stay restorable.
const LEGACY_GRUB_BACKUP_DIR: &str = "/var/backups/posam-grub";

struct LinuxBroker;

/// System files this broker is willing to manage. Anything else is refused
/// — a caller cannot point `write_system_file` at an arbitrary root-owned
/// path.
fn is_managed_system_file(path: &Path) -> bool {
    path == Path::new(GRUB_DEFAULT_PATH)
}

/// Readable-with-root files the UI legitimately needs. Same closed-list
/// principle as writes.
fn is_readable_system_file(path: &Path) -> bool {
    path == Path::new(GRUB_CFG_PATH) || path == Path::new(GRUB_DEFAULT_PATH)
}

/// Flat log files sitting directly inside /var/log — mirrors temp-clean's
/// own `is_allowed_var_log_file` rule, re-checked here independently since
/// this process runs as root. Directories (journal/, apt/, ...) are never
/// eligible: the journal has its own dedicated trim operation.
fn is_allowed_var_log_file(path: &Path) -> bool {
    let Some(parent) = path.parent().and_then(|p| p.canonicalize().ok()) else {
        return false;
    };
    parent == Path::new("/var/log") && path.is_file() && !path.is_symlink()
}

fn update_grub() -> Result<String, String> {
    run_verify("update-grub", &[])
}

impl Broker for LinuxBroker {
    fn os_name(&self) -> &'static str {
        "linux"
    }

    fn implemented_ops(&self) -> Vec<&'static str> {
        vec![
            "clean_system_paths",
            "read_system_file",
            "write_system_file",
            "restore_system_file_backup",
            "install_directory",
            "pkg_remove",
            "pkg_remove_revision",
            "pkg_cache_clean",
            "pkg_autoremove",
            "remove_kernel",
            "trim_system_logs",
            "read_boot_entries",
            "smart_read",
        ]
    }

    fn clean_system_paths(&self, paths: Vec<String>) -> CleanResult {
        let mut result = CleanResult::default();
        for raw in paths {
            let path = PathBuf::from(&raw);
            if !is_allowed_var_log_file(&path) {
                result.errors.push(format!("{raw}: poza dozwolonymi lokalizacjami — pominięto"));
                continue;
            }
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            match fs::remove_file(&path) {
                Ok(()) => {
                    result.freed_bytes += size;
                    result.removed += 1;
                }
                Err(e) => result.errors.push(format!("{raw}: {e}")),
            }
        }
        result
    }

    fn read_system_file(&self, path: String) -> Result<TextResult, String> {
        let p = PathBuf::from(&path);
        if !is_readable_system_file(&p) {
            return Err(format!("{path}: plik spoza listy dozwolonych"));
        }
        fs::read_to_string(&p).map(|content| TextResult { content }).map_err(|e| e.to_string())
    }

    fn write_system_file(&self, path: String, content: String, keep_backups: u64) -> ExecResult {
        let p = PathBuf::from(&path);
        if !is_managed_system_file(&p) {
            return ExecResult::failed(format!("{path}: plik spoza listy zarządzanych"));
        }
        broker_common::write_system_file_guarded(&p, content, keep_backups, update_grub)
    }

    fn restore_system_file_backup(&self, path: String, filename: String, keep_backups: u64) -> ExecResult {
        let p = PathBuf::from(&path);
        if !is_managed_system_file(&p) {
            return ExecResult::failed(format!("{path}: plik spoza listy zarządzanych"));
        }
        // Accepts both the shared `backup.<ts>` layout and the legacy
        // `grub.<ts>` files this module wrote before the broker was
        // generalized — a user's existing safety net must not be orphaned
        // by an internal refactor.
        if !is_safe_name(&filename) || !(filename.starts_with("backup.") || filename.starts_with("grub.")) {
            return ExecResult::failed("nieprawidłowa nazwa kopii zapasowej");
        }
        let candidates = [
            guards::backup_dir_for(&p).join(&filename),
            PathBuf::from(LEGACY_GRUB_BACKUP_DIR).join(&filename),
        ];
        let Some(content) = candidates.iter().find_map(|c| fs::read_to_string(c).ok()) else {
            return ExecResult::failed("nie znaleziono takiej kopii zapasowej");
        };
        broker_common::write_system_file_guarded(&p, content, keep_backups, update_grub)
    }

    fn install_directory(
        &self,
        source_dir: String,
        dest_name: String,
        activate_content: Option<String>,
        activate_path: Option<String>,
        keep_backups: u64,
    ) -> ExecResult {
        if !is_safe_name(&dest_name) {
            return ExecResult::failed(format!("{dest_name}: nieprawidłowa nazwa"));
        }
        let source = PathBuf::from(&source_dir);
        // A GRUB theme is identified by theme.txt — refuse anything else so
        // this can't be used as a generic "copy a tree into /boot" tool.
        if !source.join("theme.txt").is_file() {
            return ExecResult::failed("brak theme.txt w podanym folderze — pominięto");
        }
        let dest = PathBuf::from(GRUB_THEMES_DIR).join(&dest_name);
        // Shared guard — see broker_common::guards, written after a
        // self-copy zeroed a user's real theme.
        if guards::is_same_file(&source, &dest) {
            return ExecResult::failed("źródło i cel to ten sam folder — pominięto, nic nie zostało zmienione");
        }
        if let Err(e) = guards::copy_dir_recursive(&source, &dest) {
            return ExecResult::failed(format!("nie udało się skopiować: {e}"));
        }

        match (activate_content, activate_path) {
            (Some(content), Some(path)) => self.write_system_file(path, content, keep_backups),
            _ => ExecResult::ok(String::new()),
        }
    }

    fn pkg_remove(&self, source: PkgSource, id: String) -> ExecResult {
        if !is_safe_package_id(&id) {
            return ExecResult::failed(format!("{id}: nieprawidłowa nazwa pakietu — pominięto"));
        }
        match source {
            PkgSource::Apt => run_capture("apt-get", &["remove".into(), "-y".into(), id]),
            PkgSource::Snap => run_capture("snap", &["remove".into(), id]),
            other => ExecResult::failed(format!("{other:?}: nieobsługiwane źródło pakietu na Linuksie")),
        }
    }

    fn pkg_remove_revision(&self, source: PkgSource, id: String, revision: u64) -> ExecResult {
        if !is_safe_package_id(&id) {
            return ExecResult::failed(format!("{id}: nieprawidłowa nazwa pakietu — pominięto"));
        }
        match source {
            PkgSource::Snap => run_capture("snap", &["remove".into(), id, format!("--revision={revision}")]),
            other => ExecResult::failed(format!("{other:?}: rewizje obsługuje tylko snap")),
        }
    }

    fn pkg_cache_clean(&self, source: PkgSource) -> ExecResult {
        match source {
            PkgSource::Apt => run_capture("apt-get", &["clean".into()]),
            other => ExecResult::failed(format!("{other:?}: nieobsługiwane źródło pakietu")),
        }
    }

    fn pkg_autoremove(&self, source: PkgSource) -> ExecResult {
        match source {
            PkgSource::Apt => run_capture("apt-get", &["autoremove".into(), "-y".into()]),
            other => ExecResult::failed(format!("{other:?}: nieobsługiwane źródło pakietu")),
        }
    }

    /// The highest-stakes operation in this catalog (Access_plan.md marks
    /// kernel-mgr "critical"): removing the wrong kernel can leave a
    /// machine unbootable. Re-derives the running and newest kernel HERE,
    /// inside the root process, and fails closed if either can't be
    /// determined — never trusting the sidecar or frontend, and never
    /// treating "couldn't tell" as "safe".
    fn remove_kernel(&self, package: String) -> ExecResult {
        if !package.starts_with("linux-image-") || !is_safe_package_id(&package) {
            return ExecResult::failed(format!("{package}: nieprawidłowa nazwa pakietu jądra"));
        }
        let version = &package["linux-image-".len()..];

        let Some(running) = Command::new("uname")
            .arg("-r")
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty())
        else {
            return ExecResult::failed("odmowa: nie udało się ustalić aktywnego jądra");
        };
        if version == running {
            return ExecResult::failed("odmowa: to jest aktywne jądro");
        }

        let Some(latest) = fs::read_link("/boot/vmlinuz")
            .ok()
            .and_then(|p| p.file_name().map(|f| f.to_string_lossy().into_owned()))
            .and_then(|name| name.strip_prefix("vmlinuz-").map(|s| s.to_string()))
            .filter(|s| !s.is_empty())
        else {
            return ExecResult::failed("odmowa: nie udało się ustalić najnowszego jądra (brak /boot/vmlinuz)");
        };
        if version == latest {
            return ExecResult::failed("odmowa: to jest najnowsze zainstalowane jądro");
        }

        if !Path::new("/boot").join(format!("vmlinuz-{version}")).is_file() {
            return ExecResult::failed("brak takiego obrazu jądra w /boot");
        }

        run_capture("apt-get", &["remove".into(), "-y".into(), package])
    }

    fn trim_system_logs(&self, mode: TrimMode, value: u64) -> ExecResult {
        if value == 0 || value > 100_000 {
            return ExecResult::failed(format!("{value}: nieprawidłowa wartość"));
        }
        let arg = match mode {
            TrimMode::Size => format!("--vacuum-size={value}M"),
            TrimMode::Time => format!("--vacuum-time={value}d"),
        };
        run_capture("journalctl", &[arg])
    }

    fn read_boot_entries(&self) -> BootEntries {
        let entries = fs::read_to_string(GRUB_CFG_PATH)
            .map(|content| {
                content
                    .lines()
                    .filter_map(|l| {
                        let rest = l.trim_start().strip_prefix("menuentry ")?;
                        let quote = rest.chars().next()?;
                        if quote != '\'' && quote != '"' {
                            return None;
                        }
                        let rest = &rest[quote.len_utf8()..];
                        let end = rest.find(quote)?;
                        Some(rest[..end].to_string())
                    })
                    .collect()
            })
            .unwrap_or_default();
        BootEntries { entries }
    }

    /// Raw ATA/NVMe passthrough needs root, which is the whole reason this
    /// is a broker operation — the unprivileged health-monitor module can
    /// only report a permission error.
    fn smart_read(&self, device: String) -> ExecResult {
        let valid = device.starts_with("/dev/")
            && device["/dev/".len()..].chars().all(|c| c.is_ascii_alphanumeric() || c == '/');
        if !valid {
            return ExecResult::failed(format!("{device}: nieprawidłowa nazwa urządzenia"));
        }
        run_capture("smartctl", &["-a".into(), "-j".into(), device])
    }
}

fn main() {
    let broker = LinuxBroker;
    if std::env::args().nth(1).as_deref() == Some("--daemon") {
        let socket = std::env::var("POSMA_BROKER_SOCKET").unwrap_or_else(|_| DEFAULT_SOCKET_PATH.into());
        let uid_file = std::env::var("POSMA_BROKER_OWNER_UID_FILE").unwrap_or_else(|_| DEFAULT_OWNER_UID_FILE.into());
        broker_common::run_daemon(&broker, &socket, &uid_file);
    } else {
        broker_common::run_once(&broker);
    }
}
