//! pkg-cache sidecar: read-only preview of apt's download cache and
//! cleanup candidates (orphaned apt packages, disabled old snap
//! revisions). Like journald-trim, the actual cleaning always needs root
//! (writing to /var/cache/apt, removing installed packages) so there's no
//! unprivileged "attempt it" path here at all — cleaning goes entirely
//! through the privileged broker's `apt_clean`/`apt_autoremove`/
//! `snap_remove_revision` ops.
//!
//! v1 scope: apt + snap only. pacman isn't installed on the machine this
//! was built and tested on — writing pacman support blind, with no way to
//! verify the exact command output this parser depends on, risked shipping
//! something subtly wrong on a real Arch system, so it's deliberately left
//! out rather than guessed at. flatpak's "unused runtimes" concept has no
//! clean unprivileged preview command either (unlike apt's
//! `autoremove --dry-run` or snap's `list --all`) — also left for later.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"scan"}

use std::fs;
use std::io::{self, BufRead, Write};
use std::path::Path;
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
    apt_available: bool,
    apt_cache_bytes: u64,
    apt_cache_files: u64,
    apt_orphans: Vec<String>,
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

/// Only the flat `.deb` files directly inside archives/ — deliberately not
/// recursive, so the root-owned `partial/` subdirectory (permission denied
/// to read as this user, and not real cached packages anyway) is never
/// touched, not even to fail loudly on.
fn apt_cache_usage() -> (u64, u64) {
    let dir = Path::new("/var/cache/apt/archives");
    let Ok(read) = fs::read_dir(dir) else { return (0, 0) };
    let mut bytes = 0u64;
    let mut files = 0u64;
    for entry in read.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("deb") {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            bytes += meta.len();
            files += 1;
        }
    }
    (bytes, files)
}

/// Parses `apt-get autoremove --dry-run`'s own dependency-solver output —
/// deliberately not reimplementing orphan detection in Rust, since getting
/// that dependency-graph logic wrong could suggest removing something
/// still needed. Runs fine unprivileged (apt just warns that locking is
/// off and results might be stale by the time a real run happens).
fn apt_orphans() -> Vec<String> {
    let Ok(out) = Command::new("apt-get").args(["autoremove", "--dry-run"]).output() else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut collecting = false;
    let mut names = Vec::new();
    for line in text.lines() {
        if line.starts_with("The following packages will be REMOVED:") {
            collecting = true;
            continue;
        }
        if collecting {
            if line.starts_with(' ') {
                names.extend(line.split_whitespace().map(|s| s.to_string()));
            } else {
                break;
            }
        }
    }
    names
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
    let apt_available = command_exists("apt-get");
    let (apt_cache_bytes, apt_cache_files) = if apt_available { apt_cache_usage() } else { (0, 0) };
    let apt_orphans = if apt_available { apt_orphans() } else { Vec::new() };

    let snap_available = command_exists("snap");
    let snap_old_revisions = if snap_available { snap_old_revisions() } else { Vec::new() };

    ScanResult {
        apt_available,
        apt_cache_bytes,
        apt_cache_files,
        apt_orphans,
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
