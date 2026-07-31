//! journald-trim sidecar: reports how much disk space the systemd journal
//! (/var/log/journal) is using. Read-only and unprivileged — the actual
//! trim (journalctl --vacuum-size/--vacuum-time) always needs root on a
//! normal system (write access to /var/log/journal is root/systemd-journal
//! group only), so unlike temp-clean this module has no unprivileged
//! "attempt it and see" path at all: trimming goes straight through the
//! privileged broker's `vacuum_journal` op (core/src-tauri/src/lib.rs),
//! never through this binary.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"usage"}

use std::fs;
use std::io::{self, BufRead, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Usage,
}

#[derive(Serialize)]
struct UsageResult {
    total_bytes: u64,
    files: u64,
    /// false if /var/log/journal couldn't be read at all (missing journald,
    /// or a permission wall this account doesn't have — e.g. no `adm`
    /// group membership); the frontend shows an honest "unknown" instead
    /// of a misleading 0 B.
    readable: bool,
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

/// Same recursive size+count walk as temp-clean/uninstaller use — measuring
/// the directory directly is more robust than parsing `journalctl
/// --disk-usage`'s human-readable, locale-dependent text output.
fn measure(path: &Path) -> (u64, u64) {
    let mut size = 0u64;
    let mut files = 0u64;
    let Ok(read) = fs::read_dir(path) else { return (0, 0) };
    for entry in read.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            let (s, f) = measure(&entry.path());
            size += s;
            files += f;
        } else if meta.is_file() {
            size += meta.len();
            files += 1;
        }
    }
    (size, files)
}

fn usage() -> UsageResult {
    let root = Path::new("/var/log/journal");
    if !root.exists() {
        return UsageResult { total_bytes: 0, files: 0, readable: false };
    }
    let readable = fs::read_dir(root).is_ok();
    let (total_bytes, files) = if readable { measure(root) } else { (0, 0) };
    UsageResult { total_bytes, files, readable }
}

fn main() {
    let mut line = String::new();
    let output = match io::stdin().lock().read_line(&mut line) {
        Ok(0) => serde_json::to_string(&Response::<()>::Err {
            ok: false,
            error: "no command received on stdin".into(),
        }),
        Ok(_) => match serde_json::from_str::<Request>(line.trim()) {
            Ok(Request::Usage) => serde_json::to_string(&ok(usage())),
            Err(e) => serde_json::to_string(&Response::<()>::Err {
                ok: false,
                error: format!("invalid request: {e}"),
            }),
        },
        Err(e) => serde_json::to_string(&Response::<()>::Err {
            ok: false,
            error: format!("failed to read stdin: {e}"),
        }),
    };
    println!("{}", output.expect("response must serialize"));
    io::stdout().flush().ok();
}
