//! xcode-cache sidecar: what Xcode leaves behind, and how much of the disk
//! it is holding.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"scan"}
//!   {"cmd":"clean","paths":["/abs/path", ...]}
//!
//! Xcode's own directory mixes things that regenerate on the next build
//! with things that cannot be recovered at all, and they sit side by side
//! under the same parent. So this module never offers a directory it was
//! not told about: `scan` walks a fixed list of known locations, `clean`
//! re-derives that same list and refuses any path that is not inside one of
//! them. A path arriving from a stale view, or crafted, resolves to nothing.
//!
//! Nothing here needs elevation — every location is inside the user's own
//! Library.

use std::env;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Scan,
    Clean { paths: Vec<String> },
}

/// How much of a loss deleting something is, so the interface can say so
/// rather than presenting every figure as equally free to reclaim.
#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
enum Recovery {
    /// Rebuilt automatically the next time it is needed.
    Rebuilt,
    /// Comes back, but by downloading or by re-pairing a device.
    Refetched,
    /// Gone for good. Offered, never preselected.
    Permanent,
}

#[derive(Serialize)]
struct Entry {
    path: String,
    /// Directory name — a project under DerivedData, a version under
    /// DeviceSupport — so a long list can be read without the full path.
    name: String,
    size_bytes: u64,
}

#[derive(Serialize)]
struct Category {
    id: String,
    name: String,
    /// What deleting this actually costs, in the user's terms.
    note: String,
    recovery: Recovery,
    entries: Vec<Entry>,
    total_bytes: u64,
}

#[derive(Serialize)]
struct ScanResult {
    categories: Vec<Category>,
    total_bytes: u64,
    /// True when Xcode has never run here, so the interface can say that
    /// rather than showing an empty list that looks like a failure.
    xcode_present: bool,
}

#[derive(Serialize)]
struct CleanResult {
    freed_bytes: u64,
    removed: u64,
    errors: Vec<String>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Response<T> {
    Ok { ok: bool, data: T },
    Err { ok: bool, error: String },
}

fn ok<T: Serialize>(data: T) -> Response<T> {
    Response::Ok { ok: true, data }
}

fn err<T: Serialize>(error: String) -> Response<T> {
    Response::Err { ok: false, error }
}

fn home() -> PathBuf {
    env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("/"))
}

/// The locations this module knows about.
///
/// A fixed list rather than a walk of `~/Library/Developer`, because that
/// directory also holds `UserData` — code snippets, key bindings, window
/// layouts — which is the user's own work and must never appear in a list
/// headed "what can I delete".
struct Location {
    id: &'static str,
    name: &'static str,
    note: &'static str,
    recovery: Recovery,
    relative: &'static str,
    /// True when the location holds one entry per project or per version,
    /// and each should be listed separately; false when it is one lump.
    per_child: bool,
}

const LOCATIONS: &[Location] = &[
    Location {
        id: "derived-data",
        name: "DerivedData",
        note: "Wyniki kompilacji. Odbudowują się przy następnym budowaniu projektu — pierwsze potrwa dłużej.",
        recovery: Recovery::Rebuilt,
        relative: "Library/Developer/Xcode/DerivedData",
        per_child: true,
    },
    Location {
        id: "device-support",
        name: "Symbole urządzeń iOS",
        note: "Pobierane przy pierwszym podłączeniu urządzenia z danym systemem. Wrócą przy kolejnym podłączeniu.",
        recovery: Recovery::Refetched,
        relative: "Library/Developer/Xcode/iOS DeviceSupport",
        per_child: true,
    },
    Location {
        id: "watchos-support",
        name: "Symbole urządzeń watchOS",
        note: "Jak wyżej, dla zegarków.",
        recovery: Recovery::Refetched,
        relative: "Library/Developer/Xcode/watchOS DeviceSupport",
        per_child: true,
    },
    Location {
        id: "simulator-caches",
        name: "Cache symulatorów",
        note: "Odtwarzane przez CoreSimulator na żądanie.",
        recovery: Recovery::Rebuilt,
        relative: "Library/Developer/CoreSimulator/Caches",
        per_child: false,
    },
    Location {
        id: "xcode-caches",
        name: "Cache aplikacji Xcode",
        note: "Wewnętrzny cache samego Xcode.",
        recovery: Recovery::Rebuilt,
        relative: "Library/Caches/com.apple.dt.Xcode",
        per_child: false,
    },
    Location {
        id: "archives",
        name: "Archiwa",
        note: "Wydania spakowane do dystrybucji. Trzymają symbole potrzebne do odczytania raportów o awariach z Twoich wydanych aplikacji — po usunięciu nie da się ich odtworzyć.",
        recovery: Recovery::Permanent,
        relative: "Library/Developer/Xcode/Archives",
        per_child: true,
    },
];

/// Size of a directory tree. Unreadable entries are skipped rather than
/// aborting: a partial figure is more useful than none.
fn dir_size(path: &Path) -> u64 {
    let Ok(read) = fs::read_dir(path) else { return 0 };
    let mut total = 0;
    for entry in read.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
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

fn scan() -> ScanResult {
    let h = home();
    let xcode_present = h.join("Library/Developer/Xcode").is_dir();
    let mut categories = Vec::new();
    let mut grand_total = 0;

    for loc in LOCATIONS {
        let root = h.join(loc.relative);
        if !root.is_dir() {
            continue;
        }

        let mut entries = Vec::new();
        if loc.per_child {
            let Ok(read) = fs::read_dir(&root) else { continue };
            for child in read.flatten() {
                let path = child.path();
                if !path.is_dir() {
                    continue;
                }
                let size = dir_size(&path);
                entries.push(Entry {
                    name: child.file_name().to_string_lossy().into_owned(),
                    path: path.to_string_lossy().into_owned(),
                    size_bytes: size,
                });
            }
            entries.sort_by_key(|e| std::cmp::Reverse(e.size_bytes));
        } else {
            entries.push(Entry {
                name: loc.name.into(),
                path: root.to_string_lossy().into_owned(),
                size_bytes: dir_size(&root),
            });
        }

        let total: u64 = entries.iter().map(|e| e.size_bytes).sum();
        if total == 0 && entries.is_empty() {
            continue;
        }
        grand_total += total;

        categories.push(Category {
            id: loc.id.into(),
            name: loc.name.into(),
            note: loc.note.into(),
            recovery: loc.recovery,
            entries,
            total_bytes: total,
        });
    }

    ScanResult { categories, total_bytes: grand_total, xcode_present }
}

/// True when `path` sits inside one of the known locations.
///
/// Compared after resolving both sides, so a symlink planted inside
/// DerivedData cannot be used to reach somewhere else, and compared by
/// path component so a sibling directory with a longer name is not treated
/// as being inside.
fn is_offerable(path: &Path) -> bool {
    let Ok(resolved) = path.canonicalize() else { return false };
    let h = home();
    LOCATIONS.iter().any(|loc| {
        let Ok(root) = h.join(loc.relative).canonicalize() else { return false };
        resolved != root && resolved.starts_with(&root) || resolved == root
    })
}

fn clean(paths: Vec<String>) -> CleanResult {
    let mut freed = 0;
    let mut removed = 0;
    let mut errors = Vec::new();

    for raw in paths {
        let path = PathBuf::from(&raw);
        if !is_offerable(&path) {
            errors.push(format!("{raw}: poza katalogami, które ten moduł obsługuje"));
            continue;
        }
        let Ok(meta) = fs::symlink_metadata(&path) else {
            errors.push(format!("{raw}: nie istnieje"));
            continue;
        };

        let size = if meta.is_dir() { dir_size(&path) } else { meta.len() };
        let outcome = if meta.is_dir() { fs::remove_dir_all(&path) } else { fs::remove_file(&path) };

        match outcome {
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
    if io::stdin().lock().read_line(&mut line).is_err() || line.trim().is_empty() {
        return;
    }

    let response = match serde_json::from_str::<Request>(line.trim()) {
        Ok(Request::Scan) => serde_json::to_string(&ok(scan())),
        Ok(Request::Clean { paths }) => serde_json::to_string(&ok(clean(paths))),
        Err(e) => serde_json::to_string(&err::<ScanResult>(format!("Nieprawidłowe żądanie: {e}"))),
    }
    .unwrap_or_else(|e| format!(r#"{{"ok":false,"error":"{e}"}}"#));

    let mut stdout = io::stdout();
    let _ = writeln!(stdout, "{response}");
    let _ = stdout.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// UserData holds snippets, key bindings and window layouts. It sits
    /// beside DerivedData under the same parent, and listing it would offer
    /// the user their own work as rubbish.
    #[test]
    fn user_data_is_not_a_known_location() {
        assert!(
            !LOCATIONS.iter().any(|l| l.relative.contains("UserData")),
            "UserData must never be offered",
        );
    }

    /// Every location has to say what deleting it costs — the whole point
    /// of separating archives from build output.
    #[test]
    fn every_location_explains_itself() {
        for loc in LOCATIONS {
            assert!(!loc.note.trim().is_empty(), "{} has no note", loc.id);
            assert!(!loc.name.trim().is_empty(), "{} has no name", loc.id);
        }
    }

    /// Archives cannot be rebuilt; anything claiming otherwise would be
    /// presented as free to reclaim.
    #[test]
    fn archives_are_marked_unrecoverable() {
        let archives = LOCATIONS.iter().find(|l| l.id == "archives").expect("archives listed");
        assert_eq!(archives.recovery, Recovery::Permanent);
    }

    #[test]
    fn every_location_lives_inside_the_users_library() {
        for loc in LOCATIONS {
            assert!(loc.relative.starts_with("Library/"), "{} escapes Library", loc.id);
            assert!(!loc.relative.contains(".."), "{} contains traversal", loc.id);
        }
    }

    /// A path nowhere near the known locations must be refused rather than
    /// deleted, whatever the caller says.
    #[test]
    fn paths_outside_the_known_locations_are_refused() {
        for p in ["/etc/passwd", "/", "/Users/someone/Documents/thesis.pdf"] {
            assert!(!is_offerable(Path::new(p)), "{p} must not be offerable");
        }
    }

    #[test]
    fn ids_are_unique() {
        let mut ids: Vec<&str> = LOCATIONS.iter().map(|l| l.id).collect();
        ids.sort_unstable();
        let before = ids.len();
        ids.dedup();
        assert_eq!(before, ids.len(), "duplicate location id");
    }
}
