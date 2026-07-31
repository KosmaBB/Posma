//! shredder sidecar: irreversibly destroys user-picked files/folders by
//! overwriting file contents with random data a few times, renaming to a
//! random name (obscures the original filename from directory metadata),
//! then deleting.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"shred","paths":["/abs/path", ...]}
//!
//! Honesty note (also surfaced in the UI): on SSDs with wear-leveling and
//! TRIM, overwriting a file's logical bytes does NOT guarantee the physical
//! flash cells holding the old data are overwritten — the drive controller
//! may have already relocated them. This is still meaningfully more thorough
//! than a plain delete (which touches no data at all), but it is not a
//! forensic guarantee on modern SSDs.
//!
//! Safety: paths are picked one-by-one through the OS-native file dialog
//! (an explicit, deliberate per-item choice, unlike this app's other
//! scan-and-bulk-select modules), so unlike fs-user modules elsewhere this
//! one does not restrict targets to the user's home directory — secure
//! deletion of a file on a mounted USB drive is a legitimate, common use
//! case. Instead, a deny-list blocks known critical OS directories so a
//! misclick can't destroy system state; symlinks are always unlinked
//! directly, never followed into their target.

use std::fs;
use std::io::{self, BufRead, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use rand::Rng;
use serde::{Deserialize, Serialize};

const PASSES: u32 = 3;

#[cfg(target_os = "linux")]
const FORBIDDEN_ROOTS: &[&str] = &[
    "/boot", "/etc", "/usr", "/bin", "/sbin", "/lib", "/lib64", "/proc", "/sys", "/dev", "/run", "/var", "/root",
];
#[cfg(target_os = "macos")]
const FORBIDDEN_ROOTS: &[&str] = &["/System", "/Library", "/usr", "/bin", "/sbin", "/private/var", "/private/etc"];
#[cfg(target_os = "windows")]
const FORBIDDEN_ROOTS: &[&str] = &["C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)"];

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Shred { paths: Vec<String> },
}

#[derive(Serialize)]
struct ShredResult {
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

/// Refuses to touch known-critical OS directories. Resolves only the
/// *parent* directory, never the target path itself — canonicalizing the
/// full path would follow a symlink into its target, which contradicts
/// "never follow symlinks" and also breaks on a symlink whose target was
/// already shredded earlier in the same batch (target gone -> resolve
/// fails). If the parent can't be resolved, fail closed (treat as forbidden).
fn is_forbidden(path: &Path) -> bool {
    let Some(parent) = path.parent() else { return true };
    let Ok(parent_canon) = parent.canonicalize() else { return true };
    let full = parent_canon.join(path.file_name().unwrap_or_default());
    FORBIDDEN_ROOTS.iter().any(|root| {
        let root = Path::new(root);
        full == root || full.starts_with(root) || parent_canon == root || parent_canon.starts_with(root)
    })
}

fn random_suffix() -> String {
    let mut rng = rand::thread_rng();
    (0..16)
        .map(|_| {
            let n: u8 = rng.gen_range(0..36);
            std::char::from_digit(n as u32, 36).unwrap_or('x')
        })
        .collect()
}

/// Overwrites the file's existing byte range with fresh random data,
/// PASSES times, syncing to disk after each pass. Returns the file's
/// length (used for the freed-bytes tally).
fn overwrite_file(path: &Path) -> io::Result<u64> {
    let meta = fs::metadata(path)?;
    let len = meta.len();
    let mut file = fs::OpenOptions::new().write(true).open(path)?;
    let mut rng = rand::thread_rng();
    let mut buf = vec![0u8; 64 * 1024];

    for _ in 0..PASSES {
        file.seek(SeekFrom::Start(0))?;
        let mut remaining = len;
        while remaining > 0 {
            let chunk = remaining.min(buf.len() as u64) as usize;
            rng.fill(&mut buf[..chunk]);
            file.write_all(&buf[..chunk])?;
            remaining -= chunk as u64;
        }
        file.sync_all()?;
    }
    Ok(len)
}

fn rename_to_random(path: &Path) -> PathBuf {
    let Some(parent) = path.parent() else { return path.to_path_buf() };
    let candidate = parent.join(random_suffix());
    match fs::rename(path, &candidate) {
        Ok(()) => candidate,
        Err(_) => path.to_path_buf(),
    }
}

fn shred_path(path: &Path, freed: &mut u64, removed: &mut u64, errors: &mut Vec<String>) {
    let raw = path.to_string_lossy().into_owned();

    if is_forbidden(path) {
        errors.push(format!("{raw}: niedozwolona lokalizacja systemowa — pominięto"));
        return;
    }

    let Ok(meta) = fs::symlink_metadata(path) else {
        errors.push(format!("{raw}: nie znaleziono, pominięto"));
        return;
    };

    if meta.file_type().is_symlink() {
        match fs::remove_file(path) {
            Ok(()) => *removed += 1,
            Err(e) => errors.push(format!("{raw}: {e}")),
        }
        return;
    }

    if meta.is_dir() {
        if let Ok(read) = fs::read_dir(path) {
            for entry in read.flatten() {
                shred_path(&entry.path(), freed, removed, errors);
            }
        }
        match fs::remove_dir(path) {
            Ok(()) => *removed += 1,
            Err(e) => errors.push(format!("{raw}: {e}")),
        }
        return;
    }

    match overwrite_file(path) {
        Ok(len) => {
            *freed += len;
            let renamed = rename_to_random(path);
            match fs::remove_file(&renamed) {
                Ok(()) => *removed += 1,
                Err(e) => errors.push(format!("{raw}: {e}")),
            }
        }
        Err(e) => errors.push(format!("{raw}: {e}")),
    }
}

fn shred(paths: Vec<String>) -> ShredResult {
    let mut freed = 0u64;
    let mut removed = 0u64;
    let mut errors = Vec::new();

    for raw in paths {
        shred_path(Path::new(&raw), &mut freed, &mut removed, &mut errors);
    }

    ShredResult { freed_bytes: freed, removed, errors }
}

fn main() {
    let mut line = String::new();
    let output = match io::stdin().lock().read_line(&mut line) {
        Ok(0) => serde_json::to_string(&Response::<()>::Err {
            ok: false,
            error: "no command received on stdin".into(),
        }),
        Ok(_) => match serde_json::from_str::<Request>(line.trim()) {
            Ok(Request::Shred { paths }) => serde_json::to_string(&ok(shred(paths))),
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
