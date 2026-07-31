//! temp-clean sidecar: scans well-known temp/cache locations and deletes
//! only what the frontend explicitly passes back after user confirmation.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"scan"}
//!   {"cmd":"clean","paths":["/abs/path", ...]}
//!
//! Safety rules:
//!  - scan only whitelisted roots for the current OS
//!  - in shared temp dirs (/tmp, /var/tmp) only user-owned entries older than MIN_AGE
//!  - clean re-validates every path against the same whitelist before touching it

use std::env;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

/// Entries in shared temp dirs younger than this are skipped — running
/// applications keep live state there.
const MIN_AGE: Duration = Duration::from_secs(48 * 60 * 60);
/// Ignore cache subdirectories smaller than this to keep the list readable.
const MIN_CACHE_SIZE: u64 = 1024 * 1024;

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Scan,
    Clean { paths: Vec<String> },
}

#[derive(Serialize)]
struct Entry {
    path: String,
    size_bytes: u64,
    files: u64,
}

#[derive(Serialize)]
struct Category {
    id: String,
    name: String,
    entries: Vec<Entry>,
    total_bytes: u64,
}

#[derive(Serialize)]
struct ScanResult {
    categories: Vec<Category>,
    total_bytes: u64,
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

#[cfg(unix)]
fn current_uid() -> u32 {
    unsafe { libc::getuid() }
}

#[cfg(unix)]
fn owned_by_me(meta: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    meta.uid() == current_uid()
}

#[cfg(not(unix))]
fn owned_by_me(_meta: &fs::Metadata) -> bool {
    true
}

fn is_old_enough(meta: &fs::Metadata) -> bool {
    let now = SystemTime::now();
    let newest = meta
        .modified()
        .ok()
        .into_iter()
        .chain(meta.accessed().ok())
        .max()
        .unwrap_or(SystemTime::UNIX_EPOCH);
    now.duration_since(newest).map(|age| age >= MIN_AGE).unwrap_or(false)
}

/// Ensures every directory in `path`'s tree is writable by its owner, so a
/// subsequent `remove_dir_all` can unlink read-only cache trees (dotslash,
/// pip, some Xcode/Cargo artifacts mark directories `555` to guard against
/// accidental modification — that also blocks deleting their contents).
/// Best-effort: chmod failures are ignored here and surface as the real
/// removal error instead.
#[cfg(unix)]
fn make_tree_removable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    for entry in WalkDir::new(path).follow_links(false).into_iter().flatten() {
        if entry.file_type().is_dir() {
            if let Ok(meta) = entry.metadata() {
                let mut perms = meta.permissions();
                let mode = perms.mode();
                if mode & 0o200 == 0 {
                    perms.set_mode(mode | 0o700);
                    let _ = fs::set_permissions(entry.path(), perms);
                }
            }
        }
    }
}

#[cfg(not(unix))]
fn make_tree_removable(_path: &Path) {}

/// Recursively measure size + file count without following symlinks.
fn measure(path: &Path) -> (u64, u64) {
    let mut size = 0u64;
    let mut files = 0u64;
    if path.is_symlink() {
        return (0, 1);
    }
    if path.is_file() {
        return (fs::metadata(path).map(|m| m.len()).unwrap_or(0), 1);
    }
    for entry in WalkDir::new(path).follow_links(false).into_iter().flatten() {
        if entry.file_type().is_file() {
            size += entry.metadata().map(|m| m.len()).unwrap_or(0);
            files += 1;
        }
    }
    (size, files)
}

/// Whitelisted roots a clean request is allowed to touch.
fn allowed_roots() -> Vec<PathBuf> {
    let h = home();
    let mut roots = vec![h.join(".cache"), h.join(".local/share/Trash")];
    if cfg!(target_os = "linux") {
        roots.push(PathBuf::from("/tmp"));
        roots.push(PathBuf::from("/var/tmp"));
    }
    if cfg!(target_os = "macos") {
        roots.push(h.join("Library/Caches"));
        roots.push(PathBuf::from("/private/tmp"));
    }
    if cfg!(target_os = "windows") {
        if let Ok(tmp) = env::var("TEMP") {
            roots.push(PathBuf::from(tmp));
        }
        if let Ok(win) = env::var("SystemRoot") {
            roots.push(PathBuf::from(win).join("Temp"));
        }
    }
    roots
}

/// /var/log is deliberately NOT a blanket-allowed root: it holds systemd's
/// binary journal and various subsystem subdirectories (installer, apt,
/// sssd, apache2...) that must never be recursively wiped by a generic
/// "clean" click. Only flat rotated log *files* sitting directly inside
/// /var/log are eligible for deletion — exactly the syslog/kern.log-style
/// bloat this category exists to surface; journal/ and other subdirs are
/// excluded entirely (the journal has its own safe trim tool, `journalctl
/// --vacuum-size`, which needs a completely different call than unlink).
fn is_allowed_var_log_file(path: &Path) -> bool {
    if !cfg!(target_os = "linux") {
        return false;
    }
    let Some(parent) = path.parent().and_then(|p| p.canonicalize().ok()) else {
        return false;
    };
    if parent != Path::new("/var/log") {
        return false;
    }
    path.is_file() && !path.is_symlink()
}

/// Shared temp dirs: list user-owned, old-enough top-level entries.
fn scan_shared_tmp(dir: &Path) -> Vec<Entry> {
    let mut out = Vec::new();
    let Ok(read) = fs::read_dir(dir) else { return out };
    for entry in read.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if !owned_by_me(&meta) || !is_old_enough(&meta) {
            continue;
        }
        let (size, files) = measure(&path);
        if size == 0 && files == 0 {
            continue;
        }
        out.push(Entry { path: path.to_string_lossy().into_owned(), size_bytes: size, files });
    }
    out.sort_by_key(|e| std::cmp::Reverse(e.size_bytes));
    out
}

/// User cache: every top-level subdirectory as its own entry so the user
/// can pick per-application.
fn scan_user_cache(dir: &Path, skip: &[&str]) -> Vec<Entry> {
    let mut out = Vec::new();
    let Ok(read) = fs::read_dir(dir) else { return out };
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if skip.contains(&name.as_str()) {
            continue;
        }
        let path = entry.path();
        let (size, files) = measure(&path);
        if size < MIN_CACHE_SIZE {
            continue;
        }
        out.push(Entry { path: path.to_string_lossy().into_owned(), size_bytes: size, files });
    }
    out.sort_by_key(|e| std::cmp::Reverse(e.size_bytes));
    out
}

/// Flat log files directly inside /var/log, ≥1MB — the same set
/// `is_allowed_var_log_file` accepts, so everything listed here is
/// something the clean path (via the privileged broker) can actually act on.
fn scan_var_log_files() -> Vec<Entry> {
    let mut out = Vec::new();
    let Ok(read) = fs::read_dir("/var/log") else { return out };
    for entry in read.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() || path.is_symlink() || meta.len() < MIN_CACHE_SIZE {
            continue;
        }
        out.push(Entry { path: path.to_string_lossy().into_owned(), size_bytes: meta.len(), files: 1 });
    }
    out.sort_by_key(|e| std::cmp::Reverse(e.size_bytes));
    out
}

fn scan_single(path: &Path) -> Vec<Entry> {
    if !path.exists() {
        return Vec::new();
    }
    let (size, files) = measure(path);
    if size == 0 {
        return Vec::new();
    }
    vec![Entry { path: path.to_string_lossy().into_owned(), size_bytes: size, files }]
}

fn category(id: &str, name: &str, entries: Vec<Entry>) -> Category {
    let total_bytes = entries.iter().map(|e| e.size_bytes).sum();
    Category { id: id.into(), name: name.into(), entries, total_bytes }
}

fn scan() -> ScanResult {
    let h = home();
    let mut categories = Vec::new();

    if cfg!(target_os = "linux") {
        let mut tmp_entries = scan_shared_tmp(Path::new("/tmp"));
        tmp_entries.extend(scan_shared_tmp(Path::new("/var/tmp")));
        categories.push(category("tmp", "Pliki tymczasowe (starsze niż 48h)", tmp_entries));

        // A misbehaving daemon (or a snap sandboxing bug) can silently blow
        // up /var/log to gigabytes — invisible until now because nothing
        // scanned it. Only flat FILES directly inside /var/log are listed —
        // exactly the set `is_allowed_var_log_file` (and the broker's
        // mirror of it) will accept for deletion. Subdirectories like
        // journal/ or apt/ are deliberately excluded: they can never be
        // cleaned through this category (the journal has its own module),
        // so showing them would offer gigabytes that every clean attempt
        // then refuses.
        categories.push(category(
            "syslog",
            "Logi systemowe (wymaga uprawnień administratora)",
            scan_var_log_files(),
        ));
    }
    if cfg!(target_os = "macos") {
        categories.push(category("tmp", "Pliki tymczasowe (starsze niż 48h)", scan_shared_tmp(Path::new("/private/tmp"))));
    }
    if cfg!(target_os = "windows") {
        if let Ok(tmp) = env::var("TEMP") {
            categories.push(category("tmp", "Pliki tymczasowe (starsze niż 48h)", scan_shared_tmp(Path::new(&tmp))));
        }
    }

    categories.push(category(
        "thumbnails",
        "Miniatury",
        scan_single(&h.join(".cache/thumbnails")),
    ));
    categories.push(category(
        "trash",
        "Kosz",
        scan_single(&h.join(".local/share/Trash")),
    ));

    let cache_root = if cfg!(target_os = "macos") { h.join("Library/Caches") } else { h.join(".cache") };
    categories.push(category(
        "appcache",
        "Cache aplikacji (wybierz świadomie)",
        scan_user_cache(&cache_root, &["thumbnails"]),
    ));

    categories.retain(|c| !c.entries.is_empty());
    let total_bytes = categories.iter().map(|c| c.total_bytes).sum();
    ScanResult { categories, total_bytes }
}

fn clean(paths: Vec<String>) -> CleanResult {
    let roots = allowed_roots();
    let mut freed = 0u64;
    let mut removed = 0u64;
    let mut errors = Vec::new();

    for raw in paths {
        let path = PathBuf::from(&raw);
        // Canonical parent check: the path itself may be a symlink that is
        // about to be deleted, so canonicalize its parent instead.
        let inside_allowed = is_allowed_var_log_file(&path)
            || path
                .parent()
                .and_then(|p| p.canonicalize().ok())
                .map(|parent| {
                    let full = parent.join(path.file_name().unwrap_or_default());
                    roots.iter().any(|root| {
                        root.canonicalize()
                            // `full != r`: starts_with() is also true for the
                            // root itself, which would let a crafted request
                            // delete an entire whitelist root (all of /tmp,
                            // all of ~/.cache) rather than an entry inside it.
                            .map(|r| full.starts_with(&r) && full != r)
                            .unwrap_or(false)
                    })
                })
                .unwrap_or(false);

        if !inside_allowed {
            errors.push(format!("{raw}: poza dozwolonymi lokalizacjami — pominięto"));
            continue;
        }

        let (size, _files) = measure(&path);
        let result = if path.is_dir() && !path.is_symlink() {
            // Some caches (e.g. dotslash) mark extracted bundles read-only
            // to prevent tampering; that also blocks deleting them, so make
            // every directory in the tree owner-writable first.
            make_tree_removable(&path);
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
        match result {
            Ok(()) => {
                freed += size;
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
            Ok(Request::Scan) => serde_json::to_string(&ok(scan())),
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
