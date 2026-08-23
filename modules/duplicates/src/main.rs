//! duplicates sidecar: finds byte-identical files (by size then SHA-256)
//! inside common user folders and deletes the ones the user picks to keep
//! only one copy per group.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"scan"}
//!   {"cmd":"clean","paths":["/abs/path", ...]}
//!
//! Safety: scan is limited to a small whitelist of common user folders
//! (never system-wide); clean re-validates every path is inside that same
//! whitelist and additionally refuses to remove the *last* remaining file
//! of a hash it just recomputes on the spot, so a stale/crafted request
//! can never empty out a group entirely.

use std::collections::HashMap;
use scan_filter::Filter;
use std::env;
use std::fs::{self, File};
use std::io::{self, BufRead, Read, Write};
use std::path::{Path, PathBuf};

use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;
use walkdir::WalkDir;

/// Skip files smaller than this — tiny configs/icons aren't worth flagging.
const MIN_SIZE: u64 = 4 * 1024;
/// Skip trees that blow up scan time — dev caches, VCS metadata, etc.
#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Scan {
        #[serde(default)]
        blacklist: Vec<String>,
    },
    Clean { paths: Vec<String> },
    ScanVersions {
        #[serde(default)]
        blacklist: Vec<String>,
    },
    CleanVersions { paths: Vec<String> },
}

#[derive(Serialize)]
struct Group {
    hash: String,
    size_bytes: u64,
    paths: Vec<String>,
}

#[derive(Serialize)]
struct ScanResult {
    groups: Vec<Group>,
    wasted_bytes: u64,
}

#[derive(Serialize)]
struct CleanResult {
    freed_bytes: u64,
    removed: u64,
    errors: Vec<String>,
}

#[derive(Serialize)]
struct VersionItem {
    path: String,
    version: String,
    size_bytes: u64,
    is_dir: bool,
}

#[derive(Serialize)]
struct VersionGroup {
    base_name: String,
    dir: String,
    /// Sorted newest version first.
    items: Vec<VersionItem>,
}

#[derive(Serialize)]
struct VersionScanResult {
    groups: Vec<VersionGroup>,
    /// Bytes that would be freed by keeping only the newest item per group.
    total_bytes: u64,
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

/// Common duplicate hotspots inside the user's own home — never system-wide.
fn scan_roots() -> Vec<PathBuf> {
    let h = home();
    ["Downloads", "Documents", "Pictures", "Desktop", "Videos", "Music"]
        .iter()
        .map(|d| h.join(d))
        .filter(|p| p.is_dir())
        .collect()
}

fn hash_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    Ok(digest.iter().map(|b| format!("{b:02x}")).collect())
}

fn scan(blacklist: Vec<String>) -> ScanResult {
    let filter = Filter::new(blacklist);
    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();

    for root in scan_roots() {
        let walker = WalkDir::new(&root).follow_links(false).into_iter().filter_entry(|e| {
            e.file_type().is_file()
                || filter.allows(e.path())
        });
        for entry in walker.flatten() {
            if !entry.file_type().is_file() {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if meta.len() < MIN_SIZE {
                continue;
            }
            by_size.entry(meta.len()).or_default().push(entry.path().to_path_buf());
        }
    }

    let mut by_hash: HashMap<(u64, String), Vec<PathBuf>> = HashMap::new();
    for (size, paths) in by_size {
        if paths.len() < 2 {
            continue;
        }
        for path in paths {
            if let Ok(hash) = hash_file(&path) {
                by_hash.entry((size, hash)).or_default().push(path);
            }
        }
    }

    let mut groups: Vec<Group> = by_hash
        .into_iter()
        .filter(|(_, paths)| paths.len() >= 2)
        .map(|((size, hash), paths)| Group {
            hash,
            size_bytes: size,
            paths: paths.into_iter().map(|p| p.to_string_lossy().into_owned()).collect(),
        })
        .collect();

    groups.sort_by(|a, b| {
        let waste_a = a.size_bytes * (a.paths.len() as u64 - 1);
        let waste_b = b.size_bytes * (b.paths.len() as u64 - 1);
        waste_b.cmp(&waste_a)
    });

    let wasted_bytes = groups.iter().map(|g| g.size_bytes * (g.paths.len() as u64 - 1)).sum();
    ScanResult { groups, wasted_bytes }
}

fn clean(paths: Vec<String>) -> CleanResult {
    let roots = scan_roots();
    let mut freed = 0u64;
    let mut removed = 0u64;
    let mut errors = Vec::new();

    // Group requested deletions by hash (with size) so the last copy of a
    // hash can be refused rather than wiped, even if the request itself asks for all
    // known copies — this is re-derived from disk, not trusted from the
    // frontend's book-keeping.
    let mut by_hash: HashMap<String, (u64, Vec<PathBuf>)> = HashMap::new();
    for raw in &paths {
        let path = PathBuf::from(raw);
        let Ok(meta) = fs::metadata(&path) else {
            errors.push(format!("{raw}: nie znaleziono pliku, pominięto"));
            continue;
        };
        let Ok(hash) = hash_file(&path) else {
            errors.push(format!("{raw}: nie udało się odczytać pliku, pominięto"));
            continue;
        };
        by_hash.entry(hash).or_insert_with(|| (meta.len(), Vec::new())).1.push(path);
    }

    for (hash, (size, group_paths)) in by_hash {
        let total_existing = count_with_hash(&roots, size, &hash);
        let will_delete_all = group_paths.len() as u64 >= total_existing;

        for (i, path) in group_paths.into_iter().enumerate() {
            let raw = path.to_string_lossy().into_owned();

            if will_delete_all && i == 0 {
                errors.push(format!("{raw}: pominięto — to ostatnia kopia tego pliku"));
                continue;
            }

            let inside_allowed = path
                .parent()
                .and_then(|p| p.canonicalize().ok())
                .map(|parent| {
                    let full = parent.join(path.file_name().unwrap_or_default());
                    // `full != r`: starts_with() also matches the root
                    // itself, which would allow wiping all of ~/Downloads
                    // rather than a file inside it.
                    roots.iter().any(|root| {
                        root.canonicalize().map(|r| full.starts_with(&r) && full != r).unwrap_or(false)
                    })
                })
                .unwrap_or(false);

            if !inside_allowed {
                errors.push(format!("{raw}: poza dozwolonymi lokalizacjami — pominięto"));
                continue;
            }

            match fs::remove_file(&path) {
                Ok(()) => {
                    freed += size;
                    removed += 1;
                }
                Err(e) => errors.push(format!("{raw}: {e}")),
            }
        }
    }

    CleanResult { freed_bytes: freed, removed, errors }
}

/// Splits a file/dir stem like "AppName_2.2" or "Project v1.0" into
/// (base name, version string). Requires either a dotted version ("2.2")
/// or an explicit "v" prefix ("v3") to avoid false positives on ordinary
/// names that merely end in a number (photo IDs, invoice numbers, ...).
fn split_version(stem: &str) -> Option<(String, String)> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"(?i)^(?P<base>.+?)[ _\-\(]+(?P<vprefix>v)?(?P<ver>\d+(?:\.\d+){0,3})\)?$").unwrap()
    });

    let caps = re.captures(stem)?;
    let base = caps.name("base")?.as_str().trim();
    if base.is_empty() {
        return None;
    }
    let ver = caps.name("ver")?.as_str();
    let has_vprefix = caps.name("vprefix").is_some();
    if !ver.contains('.') && !has_vprefix {
        return None;
    }
    Some((base.to_string(), ver.to_string()))
}

/// Parses a dotted version string into comparable numeric components.
fn version_key(v: &str) -> Vec<u64> {
    v.split('.').map(|p| p.parse::<u64>().unwrap_or(0)).collect()
}

fn dir_size(path: &Path) -> u64 {
    WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
}

struct VersionCandidate {
    path: PathBuf,
    is_dir: bool,
    base: String,
    version: String,
}

/// Finds files/folders whose name looks like a versioned copy of the same
/// thing (e.g. "XX_2.2.zip" next to "XX_2.5.zip") — a common sign of a
/// leftover old installer/archive/build the user forgot to delete.
/// Grouped strictly within the same directory to avoid unrelated matches
/// scattered across the disk.
fn scan_versions(blacklist: Vec<String>) -> VersionScanResult {
    let filter = Filter::new(blacklist);
    let mut candidates: Vec<VersionCandidate> = Vec::new();

    for root in scan_roots() {
        let walker = WalkDir::new(&root).follow_links(false).into_iter().filter_entry(|e| {
            e.depth() == 0
                || e.file_type().is_file()
                || filter.allows(e.path())
        });
        for entry in walker.flatten() {
            if entry.depth() == 0 {
                continue;
            }
            let is_dir = entry.file_type().is_dir();
            if !is_dir && !entry.file_type().is_file() {
                continue;
            }
            let stem = if is_dir {
                entry.file_name().to_string_lossy().into_owned()
            } else {
                Path::new(entry.file_name())
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default()
            };
            if let Some((base, version)) = split_version(&stem) {
                candidates.push(VersionCandidate { path: entry.path().to_path_buf(), is_dir, base, version });
            }
        }
    }

    let mut by_key: HashMap<(String, String), Vec<VersionCandidate>> = HashMap::new();
    for c in candidates {
        let dir = c.path.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        by_key.entry((dir, c.base.to_lowercase())).or_default().push(c);
    }

    let mut groups: Vec<VersionGroup> = Vec::new();
    for ((dir, _), mut items) in by_key {
        if items.len() < 2 {
            continue;
        }
        items.sort_by_key(|i| std::cmp::Reverse(version_key(&i.version)));
        let base_name = items[0].base.clone();
        let version_items = items
            .into_iter()
            .map(|c| {
                let size_bytes = if c.is_dir { dir_size(&c.path) } else { fs::metadata(&c.path).map(|m| m.len()).unwrap_or(0) };
                VersionItem {
                    path: c.path.to_string_lossy().into_owned(),
                    version: c.version,
                    size_bytes,
                    is_dir: c.is_dir,
                }
            })
            .collect();
        groups.push(VersionGroup { base_name, dir, items: version_items });
    }

    groups.sort_by(|a, b| {
        let waste_a: u64 = a.items.iter().skip(1).map(|i| i.size_bytes).sum();
        let waste_b: u64 = b.items.iter().skip(1).map(|i| i.size_bytes).sum();
        waste_b.cmp(&waste_a)
    });

    let total_bytes = groups.iter().flat_map(|g| g.items.iter().skip(1)).map(|i| i.size_bytes).sum();
    VersionScanResult { groups, total_bytes }
}

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

/// Generic delete used by clean_versions: unlike `clean`, there is no
/// "last copy of this hash" concept here — these paths are already the
/// user's explicit picks of which superseded versions to remove — but every
/// path is still re-validated to sit inside the same folder whitelist.
fn clean_paths(paths: Vec<String>) -> CleanResult {
    let roots = scan_roots();
    let mut freed = 0u64;
    let mut removed = 0u64;
    let mut errors = Vec::new();

    for raw in paths {
        let path = PathBuf::from(&raw);

        let inside_allowed = path
            .parent()
            .and_then(|p| p.canonicalize().ok())
            .map(|parent| {
                let full = parent.join(path.file_name().unwrap_or_default());
                // See `clean` — `full != r` keeps a whitelist root itself
                // (e.g. all of ~/Downloads) from being a valid delete target.
                roots.iter().any(|root| root.canonicalize().map(|r| full.starts_with(&r) && full != r).unwrap_or(false))
            })
            .unwrap_or(false);

        if !inside_allowed {
            errors.push(format!("{raw}: poza dozwolonymi lokalizacjami — pominięto"));
            continue;
        }

        let Ok(meta) = fs::symlink_metadata(&path) else {
            errors.push(format!("{raw}: nie znaleziono, pominięto"));
            continue;
        };

        let size = if meta.is_dir() { dir_size(&path) } else { meta.len() };
        let result = if meta.is_dir() {
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

/// Counts how many files across `roots` currently have exactly `size` bytes
/// and hash to `hash` — used to verify a clean request wouldn't delete the
/// last remaining copy of a file's content.
fn count_with_hash(roots: &[PathBuf], size: u64, hash: &str) -> u64 {
    let mut count = 0u64;
    for root in roots {
        for entry in WalkDir::new(root).follow_links(false).into_iter().flatten() {
            if !entry.file_type().is_file() {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if meta.len() != size {
                continue;
            }
            if hash_file(entry.path()).map(|h| h == hash).unwrap_or(false) {
                count += 1;
            }
        }
    }
    count
}

fn main() {
    let mut line = String::new();
    let output = match io::stdin().lock().read_line(&mut line) {
        Ok(0) => serde_json::to_string(&Response::<()>::Err {
            ok: false,
            error: "no command received on stdin".into(),
        }),
        Ok(_) => match serde_json::from_str::<Request>(line.trim()) {
            Ok(Request::Scan { blacklist }) => serde_json::to_string(&ok(scan(blacklist))),
            Ok(Request::Clean { paths }) => serde_json::to_string(&ok(clean(paths))),
            Ok(Request::ScanVersions { blacklist }) => serde_json::to_string(&ok(scan_versions(blacklist))),
            Ok(Request::CleanVersions { paths }) => serde_json::to_string(&ok(clean_paths(paths))),
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
