//! pkg-cache sidecar: read-only preview of the package manager's download
//! cache and of what can be cleaned up (orphaned packages, disabled old
//! snap revisions). Like journald-trim, the actual cleaning always needs
//! root, so there's no unprivileged "attempt it" path here at all —
//! cleaning goes entirely through the privileged broker's
//! `pkg_cache_clean`/`pkg_autoremove`/`pkg_remove_revision` ops.
//!
//! Which manager is native here — apt, pacman, dnf or zypper — and how each
//! one is asked comes from the shared `distro` crate, which the broker uses
//! too. flatpak's "unused runtimes" concept has no clean unprivileged
//! preview command (unlike a dry-run autoremove or snap's `list --all`) —
//! left for later.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"scan"}

use std::fs;
use std::io::{self, BufRead, Write};
use std::process::Command;

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Scan,
}

#[derive(Serialize)]
struct SnapRevision {
    name: String,
    revision: u64,
    size_bytes: u64,
}

#[derive(Serialize)]
struct ScanResult {
    /// "apt" | "pacman" | "dnf" | "zypper" — absent where the system's
    /// packages are not ours to manage, with `unsupported` saying why.
    manager: Option<&'static str>,
    unsupported: Option<String>,
    cache_bytes: u64,
    cache_files: u64,
    orphans: Vec<String>,
    snap_available: bool,
    snap_old_revisions: Vec<SnapRevision>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Response<T: Serialize> {
    Ok { ok: bool, data: T },
    Err { ok: bool, error: String },
}

fn ok<T: Serialize>(data: T) -> Response<T> {
    Response::Ok { ok: true, data }
}

fn command_exists(program: &str) -> bool {
    Command::new(program).arg("--version").output().map(|o| o.status.success()).unwrap_or(false)
}

/// `snap list --all` lists every retained revision, not just the active
/// one — disabled rows are exactly the old revisions snapd keeps around
/// for rollback and are the safe cleanup target (the active revision of
/// each snap never carries the "disabled" note, so filtering on it can't
/// accidentally pick the one currently in use). Sizes come straight from
/// the on-disk .snap file (`stat`-level metadata is world-readable even
/// though the files themselves are mode 600) rather than trying to parse
/// one out of `snap list`, which doesn't print per-revision size at all.
fn snap_old_revisions() -> Vec<SnapRevision> {
    let Ok(out) = Command::new("snap").args(["list", "--all"]).output() else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut result = Vec::new();
    for line in text.lines().skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        let [name, _version, rev, ..] = cols[..] else { continue };
        let notes = cols.last().copied().unwrap_or("");
        if !notes.split(',').any(|n| n == "disabled") {
            continue;
        }
        let Ok(revision) = rev.parse::<u64>() else { continue };
        let size_bytes = fs::metadata(format!("/var/lib/snapd/snaps/{name}_{revision}.snap")).map(|m| m.len()).unwrap_or(0);
        result.push(SnapRevision { name: name.to_string(), revision, size_bytes });
    }
    result
}

fn scan() -> ScanResult {
    let (manager, unsupported) = match distro::manager() {
        Ok(m) => (Some(m), None),
        Err(why) => (None, Some(why)),
    };
    let (cache_bytes, cache_files) = manager.map(|m| m.cache_usage()).unwrap_or((0, 0));
    let orphans = manager.map(|m| m.orphans()).unwrap_or_default();

    let snap_available = command_exists("snap");
    let snap_old_revisions = if snap_available { snap_old_revisions() } else { Vec::new() };

    ScanResult {
        manager: manager.map(|m| m.id()),
        unsupported,
        cache_bytes,
        cache_files,
        orphans,
        snap_available,
        snap_old_revisions,
    }
}

fn main() {
    let mut line = String::new();
    let output = match io::stdin().lock().read_line(&mut line) {
        Ok(0) => serde_json::to_string(&Response::<()>::Err {
            ok: false,
            error: "no command received on stdin".into(),
        }),
        Ok(_) => match serde_json::from_str::<Request>(line.trim()) {
            Ok(Request::Scan) => serde_json::to_string(&ok(scan())),
            Err(e) => serde_json::to_string(&Response::<()>::Err { ok: false, error: format!("invalid request: {e}") }),
        },
        Err(e) => serde_json::to_string(&Response::<()>::Err {
            ok: false,
            error: format!("failed to read stdin: {e}"),
        }),
    };
    println!("{}", output.expect("response must serialize"));
    io::stdout().flush().ok();
}
