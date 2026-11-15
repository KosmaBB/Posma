//! The modules that clean a fixed list of known places in the user's
//! Library — xcode-cache, macos-slim — differ only in that list.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"scan"}
//!   {"cmd":"clean","paths":["/abs/path", ...]}
//!
//! A module never offers a directory it was not told about: `scan` walks
//! the fixed list, `clean` re-derives that same list and refuses any path
//! that is not inside one of them. A path arriving from a stale view, or
//! crafted, resolves to nothing.
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
pub enum Recovery {
    /// Rebuilt automatically the next time it is needed.
    Rebuilt,
    /// Comes back, but by downloading or by re-pairing a device.
    Refetched,
    /// Gone for good. Offered, never preselected.
    Permanent,
}

/// One place a module knows about.
pub struct Location {
    pub id: &'static str,
    pub name: &'static str,
    /// What deleting this actually costs, in the user's terms.
    pub note: &'static str,
    pub recovery: Recovery,
    /// Relative to the home directory.
    pub relative: &'static str,
    /// True when the location holds one entry per project or per version,
    /// and each should be listed separately; false when it is one lump.
    pub per_child: bool,
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
    note: String,
    recovery: Recovery,
    entries: Vec<Entry>,
    total_bytes: u64,
}

#[derive(Serialize)]
struct ScanResult {
    categories: Vec<Category>,
    total_bytes: u64,
    /// False when the application has never run here, so the interface can
    /// say that rather than showing an empty list that looks like a failure.
    present: bool,
    /// Locations that exist but the system would not let this module read —
    /// on macOS, what Full Disk Access guards.
    blocked: Vec<String>,
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

fn home() -> PathBuf {
    env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("/"))
}

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

fn entry(name: String, path: &Path) -> Entry {
    Entry { name, path: path.to_string_lossy().into_owned(), size_bytes: dir_size(path) }
}

fn scan(home: &Path, locations: &[Location], markers: &[&str]) -> ScanResult {
    let mut categories = Vec::new();
    let mut blocked = Vec::new();

    for loc in locations {
        let root = home.join(loc.relative);
        let read = match fs::read_dir(&root) {
            Ok(read) => read,
            // macOS answers EPERM for what Full Disk Access guards; saying so beats an empty list.
            Err(e) if e.kind() == io::ErrorKind::PermissionDenied => {
                blocked.push(loc.name.to_string());
                continue;
            }
            Err(_) => continue,
        };

        let mut entries: Vec<Entry> = if loc.per_child {
            read.flatten()
                .filter(|c| c.path().is_dir())
                .map(|c| entry(c.file_name().to_string_lossy().into_owned(), &c.path()))
                .collect()
        } else {
            vec![entry(loc.name.into(), &root)]
        };
        if entries.is_empty() {
            continue;
        }
        entries.sort_by_key(|e| std::cmp::Reverse(e.size_bytes));

        categories.push(Category {
            id: loc.id.into(),
            name: loc.name.into(),
            note: loc.note.into(),
            recovery: loc.recovery,
            total_bytes: entries.iter().map(|e| e.size_bytes).sum(),
            entries,
        });
    }

    ScanResult {
        total_bytes: categories.iter().map(|c| c.total_bytes).sum(),
        categories,
        present: markers.iter().any(|m| home.join(m).is_dir()),
        blocked,
    }
}

/// `path` resolved, with the resolved known location it sits inside.
///
/// Compared after resolving both sides, so a symlink planted inside a
/// location cannot be used to reach somewhere else, and compared by path
/// component so a sibling directory with a longer name is not treated as
/// being inside.
fn owning_root(home: &Path, locations: &[Location], path: &Path) -> Option<(PathBuf, PathBuf)> {
    let resolved = path.canonicalize().ok()?;
    locations
        .iter()
        .filter_map(|loc| home.join(loc.relative).canonicalize().ok())
        .find(|root| resolved.starts_with(root))
        .map(|root| (resolved, root))
}

fn remove(path: &Path) -> io::Result<()> {
    if fs::symlink_metadata(path)?.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

fn clean(home: &Path, locations: &[Location], paths: Vec<String>) -> CleanResult {
    let mut freed = 0;
    let mut removed = 0;
    let mut errors = Vec::new();

    for raw in paths {
        let Some((path, root)) = owning_root(home, locations, Path::new(&raw)) else {
            errors.push(format!("{raw}: poza katalogami, które ten moduł obsługuje"));
            continue;
        };
        // A location handed back whole is emptied, not removed: the
        // application owns the directory and may not expect to recreate it.
        // Child by child, so one file the application holds open costs that
        // file, not the count of everything else.
        let targets: Vec<PathBuf> = if path == root {
            match fs::read_dir(&path) {
                Ok(read) => read.flatten().map(|c| c.path()).collect(),
                Err(e) => {
                    errors.push(format!("{raw}: {e}"));
                    continue;
                }
            }
        } else {
            vec![path]
        };

        for target in targets {
            let size = fs::symlink_metadata(&target).map(|m| if m.is_dir() { dir_size(&target) } else { m.len() }).unwrap_or(0);
            match remove(&target) {
                Ok(()) => {
                    freed += size;
                    removed += 1;
                }
                Err(e) => errors.push(format!("{}: {e}", target.display())),
            }
        }
    }

    CleanResult { freed_bytes: freed, removed, errors }
}

/// Answers one request on stdin. `markers` are directories whose presence
/// means the application has run here at all.
pub fn serve(locations: &[Location], markers: &[&str]) {
    let mut line = String::new();
    if io::stdin().lock().read_line(&mut line).is_err() || line.trim().is_empty() {
        return;
    }

    let h = home();
    let response = match serde_json::from_str::<Request>(line.trim()) {
        Ok(Request::Scan) => serde_json::to_string(&Response::Ok { ok: true, data: scan(&h, locations, markers) }),
        Ok(Request::Clean { paths }) => serde_json::to_string(&Response::Ok { ok: true, data: clean(&h, locations, paths) }),
        Err(e) => serde_json::to_string(&Response::<()>::Err { ok: false, error: format!("Nieprawidłowe żądanie: {e}") }),
    }
    .unwrap_or_else(|e| format!(r#"{{"ok":false,"error":"{e}"}}"#));

    let mut stdout = io::stdout();
    let _ = writeln!(stdout, "{response}");
    let _ = stdout.flush();
}

/// What every module's list must satisfy; each module's tests call it.
pub fn assert_well_formed(locations: &[Location]) {
    let mut ids: Vec<&str> = locations.iter().map(|l| l.id).collect();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), locations.len(), "duplicate location id");
    for loc in locations {
        assert!(!loc.name.trim().is_empty() && !loc.note.trim().is_empty(), "{} does not explain itself", loc.id);
        assert!(loc.relative.starts_with("Library/"), "{} escapes Library", loc.id);
        assert!(!loc.relative.contains(".."), "{} contains traversal", loc.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOCATIONS: &[Location] = &[
        Location { id: "lump", name: "Lump", note: "n", recovery: Recovery::Rebuilt, relative: "Library/Lump", per_child: false },
        Location { id: "each", name: "Each", note: "n", recovery: Recovery::Permanent, relative: "Library/Each", per_child: true },
        Location { id: "shut", name: "Shut", note: "n", recovery: Recovery::Rebuilt, relative: "Library/Shut", per_child: false },
    ];

    fn sandbox(name: &str) -> PathBuf {
        let home = env::temp_dir().join(format!("library-clean-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(home.join("Library/Lump/sub")).unwrap();
        fs::write(home.join("Library/Lump/sub/a"), [0u8; 10]).unwrap();
        fs::create_dir_all(home.join("Library/Each/one")).unwrap();
        fs::write(home.join("Library/Each/one/b"), [0u8; 5]).unwrap();
        fs::create_dir_all(home.join("Documents")).unwrap();
        fs::write(home.join("Documents/thesis"), b"mine").unwrap();
        home
    }

    #[test]
    fn the_test_list_is_well_formed() {
        assert_well_formed(LOCATIONS);
    }

    #[test]
    fn scan_lists_lumps_whole_and_children_one_by_one() {
        let home = sandbox("scan");
        let result = scan(&home, LOCATIONS, &["Library/Lump"]);
        assert!(result.present);
        assert_eq!(result.total_bytes, 15);
        let each = result.categories.iter().find(|c| c.id == "each").unwrap();
        assert_eq!((each.entries.len(), each.entries[0].name.as_str()), (1, "one"));
        fs::remove_dir_all(home).unwrap();
    }

    /// A location the system will not open is reported, not shown as empty.
    #[cfg(unix)]
    #[test]
    fn an_unreadable_location_is_reported_as_blocked() {
        use std::os::unix::fs::PermissionsExt;
        let home = sandbox("blocked");
        let shut = home.join("Library/Shut");
        fs::create_dir(&shut).unwrap();
        fs::set_permissions(&shut, fs::Permissions::from_mode(0o000)).unwrap();
        let readable_anyway = fs::read_dir(&shut).is_ok(); // root reads it regardless
        let result = scan(&home, LOCATIONS, &[]);
        fs::set_permissions(&shut, fs::Permissions::from_mode(0o755)).unwrap();
        if !readable_anyway {
            assert_eq!(result.blocked, vec!["Shut".to_string()]);
        }
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn clean_refuses_anything_outside_the_known_locations() {
        let home = sandbox("refuse");
        let outside = home.join("Documents/thesis").to_string_lossy().into_owned();
        let sibling = home.join("Library/LumpX");
        fs::create_dir(&sibling).unwrap();
        let result = clean(&home, LOCATIONS, vec![outside, sibling.to_string_lossy().into_owned(), "/".into()]);
        assert_eq!((result.removed, result.errors.len()), (0, 3));
        assert!(home.join("Documents/thesis").exists() && sibling.exists());
        fs::remove_dir_all(home).unwrap();
    }

    /// Handing back a whole location empties it and leaves the directory.
    #[test]
    fn a_whole_location_is_emptied_not_removed() {
        let home = sandbox("empty");
        let lump = home.join("Library/Lump");
        let one = home.join("Library/Each/one");
        let paths = vec![lump.to_string_lossy().into_owned(), one.to_string_lossy().into_owned()];
        let result = clean(&home, LOCATIONS, paths);
        assert_eq!((result.removed, result.freed_bytes), (2, 15), "{:?}", result.errors);
        assert!(lump.is_dir() && fs::read_dir(&lump).unwrap().next().is_none());
        assert!(!one.exists());
        fs::remove_dir_all(home).unwrap();
    }
}
