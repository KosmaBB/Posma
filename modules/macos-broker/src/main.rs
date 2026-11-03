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
//!  - `create_restore_point`, `component_store_cleanup` — Windows-only
//!    concepts.
//!
//! Implemented here because their command shape is unambiguous and
//! independently validated before running, and because a module calls them:
//!  - `delete_local_snapshots` (`tmutil`)
//!  - `clean_system_paths` against a closed macOS path whitelist
//!
//! Left out on purpose:
//!  - Homebrew. It refuses to run as root, and its prefix — /opt/homebrew
//!    on Apple silicon, /usr/local on Intel — belongs to the user, so
//!    anything a root process ran from there would be the user's to swap.
//!    Package work on macOS is unprivileged.
//!  - `smart_read`, for the same reason: smartctl comes from Homebrew, and
//!    macOS hands SMART to an ordinary user anyway, so health-monitor reads
//!    it itself.
//!  - `trim_system_logs`. `log erase` takes no age — `--ttl` means the
//!    time-to-live entries, not "older than" — so there is nothing honest
//!    to map a request for N days onto.
//!
//! Elevation: per call, the core runs this binary through `osascript`'s
//! `do shell script ... with administrator privileges`, passing the request
//! as `--request` since that prompt forwards no stdin. An installed
//! SMAppService helper is the "Pełny" path still to come (Access_plan.md
//! §4); the daemon mode from broker-common works as-is here, its peer check
//! being `getpeereid`.

use std::path::PathBuf;

use broker_common::result::{CleanResult, ExecResult};
use broker_common::{run_capture, Broker};

const DEFAULT_SOCKET_PATH: &str = "/var/run/posma-broker.sock";
const DEFAULT_OWNER_UID_FILE: &str = "/etc/posma/broker-owner-uid";

struct MacosBroker;

/// System-scope caches/logs this broker may delete from. Mirrors the
/// unprivileged macOS module's own whitelist; kept deliberately narrow.
const ALLOWED_CLEAN_ROOTS: [&str; 3] = ["/Library/Caches", "/System/Library/Caches", "/private/var/log"];


impl Broker for MacosBroker {
    fn os_name(&self) -> &'static str {
        "macos"
    }

    fn implemented_ops(&self) -> Vec<&'static str> {
        vec!["clean_system_paths", "delete_local_snapshots"]
    }

    fn clean_system_paths(&self, paths: Vec<String>) -> CleanResult {
        broker_common::clean_within(paths, &ALLOWED_CLEAN_ROOTS.map(PathBuf::from))
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
            // "com.apple.TimeMachine.2026-10-19-101500.local" — deletelocalsnapshots takes the date alone.
            .filter_map(|l| l.trim().strip_prefix("com.apple.TimeMachine.").map(|s| s.trim_end_matches(".local").to_string()))
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
