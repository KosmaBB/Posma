//! big-files sidecar: finds the largest files under the user's home
//! directory so they can be reviewed and deleted after confirmation.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"scan"}
//!   {"cmd":"clean","paths":["/abs/path", ...]}
//!
//! Safety: scan never leaves the user's home directory (no elevation, no
//! system-wide walk — that's the planned "fs-scan" capability, not this);
//! clean re-validates every path is inside home and is a regular file
//! (never a directory) before touching it.

use std::env;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

/// Defaults when the frontend doesn't override them.
const DEFAULT_MIN_SIZE_MB: u64 = 20;
const DEFAULT_MAX_RESULTS: usize = 200;
/// Hard ceilings so a crafted/garbage request can't force a pathological
/// scan or an unbounded response — independent of whatever the UI sends.
const MAX_ALLOWED_MIN_SIZE_MB: u64 = 100_000;
const MAX_ALLOWED_RESULTS: usize = 2_000;

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Scan {
        #[serde(default)]
        min_size_mb: Option<u64>,
        #[serde(default)]
        max_results: Option<usize>,
    },
    Clean {
        paths: Vec<String>,
    },
}

#[derive(Serialize)]
struct FileEntry {
    path: String,
    size_bytes: u64,
}

#[derive(Serialize)]
struct ScanResult {
    files: Vec<FileEntry>,
    total_bytes: u64,
    truncated: bool,
}

#[derive(Serialize)]
struct CleanResult {
    freed_bytes: u64,
    removed: u64,
    errors: Vec<String>,
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

fn home() -> PathBuf {
    PathBuf::from(env::var("HOME").unwrap_or_else(|_| "/root".into()))
}

fn scan(min_size_mb: Option<u64>, max_results: Option<usize>) -> ScanResult {
    let min_size_mb = min_size_mb.unwrap_or(DEFAULT_MIN_SIZE_MB).clamp(1, MAX_ALLOWED_MIN_SIZE_MB);
    let min_size = min_size_mb * 1024 * 1024;
    let max_results = max_results.unwrap_or(DEFAULT_MAX_RESULTS).clamp(1, MAX_ALLOWED_RESULTS);

    let h = home();
    let mut files: Vec<FileEntry> = Vec::new();

    for entry in WalkDir::new(&h).follow_links(false).into_iter().flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        // Git's packed object store is legitimately large but not something
        // a user can usefully "clean" one file at a time — skip it to keep
        // the list actionable; everything else (build artifacts, VM disks,
        // downloads...) stays, since those genuinely are worth surfacing.
        if entry.path().components().any(|c| c.as_os_str() == ".git") {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if meta.len() < min_size {
            continue;
        }
        files.push(FileEntry { path: entry.path().to_string_lossy().into_owned(), size_bytes: meta.len() });
    }

    files.sort_by_key(|e| std::cmp::Reverse(e.size_bytes));
    let total_bytes = files.iter().map(|f| f.size_bytes).sum();
    let truncated = files.len() > max_results;
    files.truncate(max_results);

    ScanResult { files, total_bytes, truncated }
}

fn clean(paths: Vec<String>) -> CleanResult {
    let mut freed = 0u64;
    let mut removed = 0u64;
    let mut errors = Vec::new();

    let Ok(home_canon) = home().canonicalize() else {
        errors.push("nie udało się rozwiązać katalogu domowego".into());
        return CleanResult { freed_bytes: 0, removed: 0, errors };
    };

    for raw in paths {
        let path = PathBuf::from(&raw);

        let inside_home = path
            .parent()
            .and_then(|p| p.canonicalize().ok())
            .map(|parent| {
                let full = parent.join(path.file_name().unwrap_or_default());
                full.starts_with(&home_canon)
            })
            .unwrap_or(false);

        if !inside_home {
            errors.push(format!("{raw}: poza katalogiem domowym — pominięto"));
            continue;
        }

        let Ok(meta) = fs::symlink_metadata(&path) else {
            errors.push(format!("{raw}: nie znaleziono pliku, pominięto"));
            continue;
        };
        if !meta.is_file() {
            errors.push(format!("{raw}: to nie jest zwykły plik — pominięto"));
            continue;
        }

        match fs::remove_file(&path) {
            Ok(()) => {
                freed += meta.len();
                removed += 1;
            }
            Err(e) => errors.push(format!("{raw}: {e}")),
        }
    }

    CleanResult { freed_bytes: freed, removed, errors }
}

fn main() {
    let mut line = String::new();
    let output = match io::stdin().lock().read_line(&mut line) {
        Ok(0) => serde_json::to_string(&Response::<()>::Err {
            ok: false,
            error: "no command received on stdin".into(),
        }),
        Ok(_) => match serde_json::from_str::<Request>(line.trim()) {
            Ok(Request::Scan { min_size_mb, max_results }) => serde_json::to_string(&ok(scan(min_size_mb, max_results))),
            Ok(Request::Clean { paths }) => serde_json::to_string(&ok(clean(paths))),
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
