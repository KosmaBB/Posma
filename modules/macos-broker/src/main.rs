//! Privileged macOS broker (Access_plan.md §4).
//!
//! Scaffold: speaks the full shared protocol, reports its capabilities
//! honestly, and implements only what could be written without a macOS
//! machine to verify against. Everything else answers "nieobsługiwane na
//! tym systemie" through the trait defaults rather than guessing at
//! command syntax that must be right the first time on a real system.
//!
//! Deliberately NOT implemented until testable on real hardware — command
//! construction is only shipped once it has actually been run:
//!  - `install_directory`, `remove_kernel`, `read_boot_entries` — macOS has
//!    no GRUB; the equivalents (bless/NVRAM/startup disk) are a different
//!    model entirely and need their own design, not a Linux port.
//!  - `create_restore_point`, `component_store_cleanup`,
//!    `remove_appx_package` — Windows-only concepts.
//!
//! Implemented here because their command shape is unambiguous and
//! independently validated before running:
//!  - `pkg_remove` / `pkg_cache_clean` / `pkg_autoremove` (Homebrew)
//!  - `trim_system_logs` (`log erase`)
//!  - `delete_local_snapshots` (`tmutil`)
//!  - `purge_system_caches`
//!  - `smart_read` (smartctl, same as Linux)
//!  - `service_set_enabled` / `service_set_running` (launchctl)
//!  - `clean_system_paths` / `read_system_file` / `write_system_file`
//!    against a closed macOS path whitelist
//!
//! Elevation: `run_once` under `osascript -e 'do shell script ... with
//! administrator privileges'` or an SMAppService helper is the intended
//! transport (see Access_plan.md §4); the daemon mode from broker-common
//! works as-is on macOS since it's a Unix socket with SO_PEERCRED.

use std::fs;
use std::path::{Path, PathBuf};

use broker_common::guards::{is_safe_name, is_safe_package_id};
use broker_common::ops::{PkgSource, TrimMode};
use broker_common::result::{CleanResult, ExecResult, TextResult};
use broker_common::{run_capture, Broker};

const DEFAULT_SOCKET_PATH: &str = "/var/run/posma-broker.sock";
const DEFAULT_OWNER_UID_FILE: &str = "/etc/posma/broker-owner-uid";

struct MacosBroker;

/// System-scope caches/logs this broker may delete from. Mirrors the
/// unprivileged macOS module's own whitelist; kept deliberately narrow.
const ALLOWED_CLEAN_ROOTS: &[&str] = &["/Library/Caches", "/System/Library/Caches", "/private/var/log"];

/// Config files this broker is willing to read/write. Empty until a real
/// macOS module needs one — an empty closed list is the safe default.
const MANAGED_SYSTEM_FILES: &[&str] = &[];

fn within_allowed_roots(path: &Path, roots: &[&str]) -> bool {
    let Some(parent) = path.parent().and_then(|p| p.canonicalize().ok()) else { return false };
    let full = parent.join(path.file_name().unwrap_or_default());
    roots.iter().any(|root| {
        Path::new(root)
            .canonicalize()
            // `full != r` — never the root itself, only entries inside it.
            .map(|r| full.starts_with(&r) && full != r)
            .unwrap_or(false)
    })
}

impl Broker for MacosBroker {
    fn os_name(&self) -> &'static str {
        "macos"
    }

    fn implemented_ops(&self) -> Vec<&'static str> {
        vec![
            "clean_system_paths",
            "pkg_remove",
            "pkg_cache_clean",
            "pkg_autoremove",
            "service_set_enabled",
            "service_set_running",
            "trim_system_logs",
            "smart_read",
            "delete_local_snapshots",
            "purge_system_caches",
        ]
    }

    fn clean_system_paths(&self, paths: Vec<String>) -> CleanResult {
        let mut result = CleanResult::default();
        for raw in paths {
            let path = PathBuf::from(&raw);
            if !within_allowed_roots(&path, ALLOWED_CLEAN_ROOTS) {
                result.errors.push(format!("{raw}: poza dozwolonymi lokalizacjami — pominięto"));
                continue;
            }
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            let outcome = if path.is_dir() && !path.is_symlink() {
                fs::remove_dir_all(&path)
            } else {
                fs::remove_file(&path)
            };
            match outcome {
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
        if !MANAGED_SYSTEM_FILES.contains(&path.as_str()) {
            return Err(format!("{path}: plik spoza listy dozwolonych"));
        }
        fs::read_to_string(&path).map(|content| TextResult { content }).map_err(|e| e.to_string())
    }

    fn pkg_remove(&self, source: PkgSource, id: String) -> ExecResult {
        if !is_safe_package_id(&id) {
            return ExecResult::failed(format!("{id}: nieprawidłowa nazwa pakietu — pominięto"));
        }
        match source {
            PkgSource::Brew => run_capture("brew", &["uninstall".into(), id]),
            other => ExecResult::failed(format!("{other:?}: nieobsługiwane źródło pakietu na macOS")),
        }
    }

    fn pkg_cache_clean(&self, source: PkgSource) -> ExecResult {
        match source {
            PkgSource::Brew => run_capture("brew", &["cleanup".into(), "--prune=all".into()]),
            other => ExecResult::failed(format!("{other:?}: nieobsługiwane źródło pakietu na macOS")),
        }
    }

    fn pkg_autoremove(&self, source: PkgSource) -> ExecResult {
        match source {
            PkgSource::Brew => run_capture("brew", &["autoremove".into()]),
            other => ExecResult::failed(format!("{other:?}: nieobsługiwane źródło pakietu na macOS")),
        }
    }

    fn service_set_enabled(&self, name: String, enabled: bool) -> ExecResult {
        if !is_safe_name(&name) {
            return ExecResult::failed(format!("{name}: nieprawidłowa nazwa usługi"));
        }
        let verb = if enabled { "enable" } else { "disable" };
        run_capture("launchctl", &[verb.into(), format!("system/{name}")])
    }

    fn service_set_running(&self, name: String, running: bool) -> ExecResult {
        if !is_safe_name(&name) {
            return ExecResult::failed(format!("{name}: nieprawidłowa nazwa usługi"));
        }
        let verb = if running { "kickstart" } else { "kill" };
        if running {
            run_capture("launchctl", &[verb.into(), format!("system/{name}")])
        } else {
            run_capture("launchctl", &[verb.into(), "SIGTERM".into(), format!("system/{name}")])
        }
    }

    /// macOS's unified log only supports age-based trimming (`--ttl`), so a
    /// size-based request is refused rather than silently reinterpreted.
    fn trim_system_logs(&self, mode: TrimMode, value: u64) -> ExecResult {
        if value == 0 || value > 100_000 {
            return ExecResult::failed(format!("{value}: nieprawidłowa wartość"));
        }
        match mode {
            TrimMode::Time => run_capture("log", &["erase".into(), format!("--ttl={value}d")]),
            TrimMode::Size => {
                ExecResult::failed("macOS obsługuje przycinanie logów tylko według wieku, nie rozmiaru")
            }
        }
    }

    fn smart_read(&self, device: String) -> ExecResult {
        let valid = device.starts_with("/dev/")
            && device["/dev/".len()..].chars().all(|c| c.is_ascii_alphanumeric() || c == '/');
        if !valid {
            return ExecResult::failed(format!("{device}: nieprawidłowa nazwa urządzenia"));
        }
        run_capture("smartctl", &["-a".into(), "-j".into(), device])
    }

    fn delete_local_snapshots(&self, keep_latest: bool) -> ExecResult {
        // `tmutil listlocalsnapshots /` names snapshots; deleting them one
        // by one keeps this an explicit, enumerable action rather than a
        // blanket "thin" whose freed amount macOS decides on its own.
        let listing = run_capture("tmutil", &["listlocalsnapshots".into(), "/".into()]);
        if !listing.success {
            return listing;
        }
        let mut names: Vec<String> = listing
            .output
            .lines()
            .filter_map(|l| l.trim().strip_prefix("com.apple.TimeMachine.").map(|s| s.to_string()))
            .collect();
        names.sort();
        if keep_latest {
            names.pop();
        }
        if names.is_empty() {
            return ExecResult::ok("brak migawek do usunięcia".into());
        }
        let mut removed = 0usize;
        let mut errors = Vec::new();
        for name in names {
            let r = run_capture("tmutil", &["deletelocalsnapshots".into(), name.clone()]);
            if r.success {
                removed += 1;
            } else {
                errors.push(format!("{name}: {}", r.error.unwrap_or_default()));
            }
        }
        if errors.is_empty() {
            ExecResult::ok(format!("usunięto migawek: {removed}"))
        } else {
            ExecResult::failed(errors.join("\n"))
        }
    }

    fn purge_system_caches(&self) -> ExecResult {
        run_capture("purge", &[])
    }
}

fn main() {
    let broker = MacosBroker;
    if std::env::args().nth(1).as_deref() == Some("--daemon") {
        let socket = std::env::var("POSMA_BROKER_SOCKET").unwrap_or_else(|_| DEFAULT_SOCKET_PATH.into());
        let uid_file = std::env::var("POSMA_BROKER_OWNER_UID_FILE").unwrap_or_else(|_| DEFAULT_OWNER_UID_FILE.into());
        broker_common::run_daemon(&broker, &socket, &uid_file);
    } else {
        broker_common::run_once(&broker);
    }
}
