//! disk-map sidecar: read-only directory-size explorer. Lists the immediate
//! children of a directory (default: home), each with its total size, sorted
//! largest first — the frontend renders this as a ranked bar list and lets
//! the user drill into a child directory one level at a time.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"scan","path":"/abs/path"}   // path omitted/null -> home directory
//!
//! Read-only: there is no delete/clean action here, so unlike the other
//! fs-user modules there's no home-directory restriction — browsing anywhere
//! the OS lets the user read (e.g. a picked external drive) is harmless.
//!
//! Symlinks are listed as small leaf entries (their own lstat size, never
//! the target's) rather than followed — this avoids cycles and double-
//! counting when a symlink points back up the tree or across directories.

use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const MAX_ENTRIES: usize = 40;

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Scan {
        #[serde(default)]
        path: Option<String>,
    },
}

#[derive(Serialize)]
struct Entry {
    name: String,
    path: Option<String>, // None for the aggregated "other" bucket — not drillable
    is_dir: bool,
    size_bytes: u64,
}

#[derive(Serialize)]
struct ScanData {
    path: String,
    parent: Option<String>,
    entries: Vec<Entry>,
    total_bytes: u64,
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

fn home_dir() -> PathBuf {
    if let Ok(h) = std::env::var("HOME") {
        return PathBuf::from(h);
    }
    if let Ok(h) = std::env::var("USERPROFILE") {
        return PathBuf::from(h);
    }
    PathBuf::from(".")
}

/// Sums file sizes under `path` recursively. Symlinks are never followed
/// (their own tiny lstat size would otherwise double-count or cycle).
/// Unreadable entries are silently skipped — a partial total from a
/// permission-denied subtree is more useful than aborting the whole scan.
fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let Ok(read) = fs::read_dir(path) else { return 0 };
    for entry in read.flatten() {
        let Ok(meta) = entry.metadata() else { continue }; // lstat — does not follow symlinks
        if meta.file_type().is_symlink() {
            continue;
        } else if meta.is_dir() {
            total += dir_size(&entry.path());
        } else {
            total += meta.len();
        }
    }
    total
}

fn scan(path: Option<String>) -> ScanData {
    let root = path.map(PathBuf::from).unwrap_or_else(home_dir);
    let mut entries = Vec::new();
    let mut errors = Vec::new();

    match fs::read_dir(&root) {
        Ok(read) => {
            for entry in read.flatten() {
                let p = entry.path();
                let name = entry.file_name().to_string_lossy().into_owned();
                let Ok(meta) = entry.metadata() else {
                    errors.push(format!("{}: nie udało się odczytać", p.display()));
                    continue;
                };
                let is_dir = meta.is_dir(); // false for symlinks — lstat metadata never reports symlink-to-dir as a dir
                let size = if is_dir { dir_size(&p) } else { meta.len() };
                entries.push(Entry { name, path: Some(p.to_string_lossy().into_owned()), is_dir, size_bytes: size });
            }
        }
        Err(e) => errors.push(format!("{}: {e}", root.display())),
    }

    entries.sort_by_key(|e| std::cmp::Reverse(e.size_bytes));
    let total_bytes: u64 = entries.iter().map(|e| e.size_bytes).sum();

    if entries.len() > MAX_ENTRIES {
        let tail_count = entries.len() - MAX_ENTRIES;
        let tail_bytes: u64 = entries[MAX_ENTRIES..].iter().map(|e| e.size_bytes).sum();
        entries.truncate(MAX_ENTRIES);
        if tail_bytes > 0 {
            entries.push(Entry { name: format!("Inne ({tail_count} pozycji)"), path: None, is_dir: false, size_bytes: tail_bytes });
        }
    }

    let parent = root.parent().map(|p| p.to_string_lossy().into_owned());
    ScanData { path: root.to_string_lossy().into_owned(), parent, entries, total_bytes, errors }
}

fn main() {
    let mut line = String::new();
    let output = match io::stdin().lock().read_line(&mut line) {
        Ok(0) => serde_json::to_string(&Response::<()>::Err {
            ok: false,
            error: "no command received on stdin".into(),
        }),
        Ok(_) => match serde_json::from_str::<Request>(line.trim()) {
            Ok(Request::Scan { path }) => serde_json::to_string(&ok(scan(path))),
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
