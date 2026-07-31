//! browser-hygiene sidecar: detects installed browser profiles and clears
//! cache/cookies/history per profile after confirmation.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"scan"}
//!   {"cmd":"clean","paths":["/abs/path", ...]}
//!
//! Scope and safety:
//!  - Firefox history is deliberately NOT offered: Firefox stores history and
//!    bookmarks in the same file (places.sqlite), so deleting "history"
//!    would risk destroying bookmarks too. Only cache and cookies are
//!    offered for Firefox; history is Chrome-family only, where History is
//!    a separate file from Bookmarks.
//!  - Cache entries are real, individual on-disk subdirectories (Cache,
//!    Code Cache, GPUCache, cache2, ...) so `clean` stays a plain per-path
//!    delete, identical to temp-clean's model — no cross-file bundling.
//!  - Profile directories are entirely user-owned, so no elevation and no
//!    extra path-safety whitelist is needed beyond "it's inside one of the
//!    browser base directories discovered by the scan".
//!  - Detected running browsers are reported (not blocked) so the frontend
//!    can warn before the user clears a live profile's data.

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

#[derive(Serialize)]
struct Entry {
    label: String,
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
    running_browsers: Vec<String>,
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
    if let Ok(h) = env::var("HOME") {
        return PathBuf::from(h);
    }
    if let Ok(h) = env::var("USERPROFILE") {
        return PathBuf::from(h);
    }
    PathBuf::from(".")
}

/// Recursively sums size + file count. Symlinks are never followed.
fn measure(path: &Path) -> (u64, u64) {
    let Ok(meta) = fs::symlink_metadata(path) else { return (0, 0) };
    if meta.file_type().is_symlink() {
        return (0, 0);
    }
    if meta.is_file() {
        return (meta.len(), 1);
    }
    let mut size = 0u64;
    let mut files = 0u64;
    if let Ok(read) = fs::read_dir(path) {
        for entry in read.flatten() {
            let (s, f) = measure(&entry.path());
            size += s;
            files += f;
        }
    }
    (size, files)
}

enum Kind {
    Firefox,
    Chromium,
}

struct BrowserDef {
    name: &'static str,
    kind: Kind,
    /// Candidate base directories, checked in order — the first that exists
    /// wins. Covers apt/traditional installs, snap, and flatpak on Linux.
    bases: Vec<PathBuf>,
    /// Process names to look for under /proc to flag "currently running".
    process_names: &'static [&'static str],
}

fn browser_defs() -> Vec<BrowserDef> {
    let h = home();
    let mut defs = Vec::new();

    if cfg!(target_os = "linux") {
        defs.push(BrowserDef {
            name: "Firefox",
            kind: Kind::Firefox,
            bases: vec![
                h.join(".mozilla/firefox"),
                h.join("snap/firefox/common/.mozilla/firefox"),
                h.join(".var/app/org.mozilla.firefox/.mozilla/firefox"),
            ],
            process_names: &["firefox", "firefox-bin"],
        });
        defs.push(BrowserDef {
            name: "Google Chrome",
            kind: Kind::Chromium,
            bases: vec![h.join(".config/google-chrome")],
            process_names: &["chrome", "google-chrome"],
        });
        defs.push(BrowserDef {
            name: "Chromium",
            kind: Kind::Chromium,
            bases: vec![h.join(".config/chromium"), h.join("snap/chromium/current/.config/chromium")],
            process_names: &["chromium", "chromium-browser"],
        });
        defs.push(BrowserDef {
            name: "Brave",
            kind: Kind::Chromium,
            bases: vec![
                h.join(".config/BraveSoftware/Brave-Browser"),
                h.join("snap/brave/current/.config/BraveSoftware/Brave-Browser"),
            ],
            process_names: &["brave", "brave-browser"],
        });
        defs.push(BrowserDef {
            name: "Microsoft Edge",
            kind: Kind::Chromium,
            bases: vec![h.join(".config/microsoft-edge")],
            process_names: &["msedge", "microsoft-edge"],
        });
        defs.push(BrowserDef {
            name: "Opera",
            kind: Kind::Chromium,
            bases: vec![h.join(".config/opera")],
            process_names: &["opera"],
        });
        defs.push(BrowserDef {
            name: "Vivaldi",
            kind: Kind::Chromium,
            bases: vec![h.join(".config/vivaldi")],
            process_names: &["vivaldi", "vivaldi-bin"],
        });
    }
    if cfg!(target_os = "macos") {
        let support = h.join("Library/Application Support");
        defs.push(BrowserDef {
            name: "Firefox",
            kind: Kind::Firefox,
            bases: vec![support.join("Firefox/Profiles")],
            process_names: &["firefox"],
        });
        defs.push(BrowserDef {
            name: "Google Chrome",
            kind: Kind::Chromium,
            bases: vec![support.join("Google/Chrome")],
            process_names: &["Google Chrome"],
        });
        defs.push(BrowserDef {
            name: "Brave",
            kind: Kind::Chromium,
            bases: vec![support.join("BraveSoftware/Brave-Browser")],
            process_names: &["Brave Browser"],
        });
    }
    if cfg!(target_os = "windows") {
        if let Ok(appdata) = env::var("APPDATA") {
            defs.push(BrowserDef {
                name: "Firefox",
                kind: Kind::Firefox,
                bases: vec![PathBuf::from(&appdata).join("Mozilla/Firefox/Profiles")],
                process_names: &["firefox.exe"],
            });
        }
        if let Ok(local) = env::var("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            defs.push(BrowserDef {
                name: "Google Chrome",
                kind: Kind::Chromium,
                bases: vec![local.join("Google/Chrome/User Data")],
                process_names: &["chrome.exe"],
            });
            defs.push(BrowserDef {
                name: "Microsoft Edge",
                kind: Kind::Chromium,
                bases: vec![local.join("Microsoft/Edge/User Data")],
                process_names: &["msedge.exe"],
            });
        }
    }

    defs
}

/// Firefox profile directories are marked by containing prefs.js directly.
fn firefox_profiles(base: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let Ok(read) = fs::read_dir(base) else { return out };
    for entry in read.flatten() {
        let path = entry.path();
        if !path.is_dir() || !path.join("prefs.js").is_file() {
            continue;
        }
        let dirname = entry.file_name().to_string_lossy().into_owned();
        let label = dirname.split_once('.').map(|(_, rest)| rest).unwrap_or(&dirname).to_string();
        out.push((label, path));
    }
    out
}

/// Chromium-family profile directories: "Default" or "Profile N".
fn chromium_profiles(base: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let Ok(read) = fs::read_dir(base) else { return out };
    for entry in read.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if !path.is_dir() {
            continue;
        }
        if name == "Default" || name.starts_with("Profile ") {
            out.push((name, path));
        }
    }
    out
}

#[cfg(target_os = "linux")]
fn is_running(process_names: &[&str]) -> bool {
    let Ok(read) = fs::read_dir("/proc") else { return false };
    for entry in read.flatten() {
        let Ok(comm) = fs::read_to_string(entry.path().join("comm")) else { continue };
        let comm = comm.trim();
        if process_names.iter().any(|n| *n == comm) {
            return true;
        }
    }
    false
}

#[cfg(not(target_os = "linux"))]
fn is_running(_process_names: &[&str]) -> bool {
    false
}

fn add_if_exists(entries: &mut Vec<Entry>, label: String, path: PathBuf) {
    if !path.exists() {
        return;
    }
    let (size, files) = measure(&path);
    if size == 0 {
        return;
    }
    entries.push(Entry { label, path: path.to_string_lossy().into_owned(), size_bytes: size, files });
}

fn category(id: &str, name: &str, entries: Vec<Entry>) -> Category {
    let total_bytes = entries.iter().map(|e| e.size_bytes).sum();
    Category { id: id.into(), name: name.into(), entries, total_bytes }
}

fn scan() -> ScanResult {
    let mut cache_entries = Vec::new();
    let mut cookie_entries = Vec::new();
    let mut history_entries = Vec::new();
    let mut running = Vec::new();

    for def in browser_defs() {
        let Some(base) = def.bases.iter().find(|b| b.is_dir()) else { continue };
        if is_running(def.process_names) {
            running.push(def.name.to_string());
        }

        match def.kind {
            Kind::Firefox => {
                for (profile_label, profile_dir) in firefox_profiles(base) {
                    let tag = format!("{} — {profile_label}", def.name);
                    for sub in ["cache2", "startupCache", "OfflineCache"] {
                        add_if_exists(&mut cache_entries, format!("{tag} — {sub}"), profile_dir.join(sub));
                    }
                    add_if_exists(&mut cookie_entries, format!("{tag} — cookies.sqlite"), profile_dir.join("cookies.sqlite"));
                    // History deliberately omitted — see module doc comment.
                }
            }
            Kind::Chromium => {
                for (profile_label, profile_dir) in chromium_profiles(base) {
                    let tag = format!("{} — {profile_label}", def.name);
                    for sub in ["Cache", "Code Cache", "GPUCache"] {
                        add_if_exists(&mut cache_entries, format!("{tag} — {sub}"), profile_dir.join(sub));
                    }
                    let network_cookies = profile_dir.join("Network/Cookies");
                    if network_cookies.exists() {
                        add_if_exists(&mut cookie_entries, format!("{tag} — Cookies"), network_cookies);
                    } else {
                        add_if_exists(&mut cookie_entries, format!("{tag} — Cookies"), profile_dir.join("Cookies"));
                    }
                    add_if_exists(&mut history_entries, format!("{tag} — Historia"), profile_dir.join("History"));
                }
            }
        }
    }

    for entries in [&mut cache_entries, &mut cookie_entries, &mut history_entries] {
        entries.sort_by(|a: &Entry, b: &Entry| b.size_bytes.cmp(&a.size_bytes));
    }

    let categories = vec![
        category("cache", "Pamięć podręczna", cache_entries),
        category("cookies", "Ciasteczka (wyloguje ze stron)", cookie_entries),
        category("history", "Historia przeglądania (tylko przeglądarki oparte na Chromium)", history_entries),
    ];
    let categories: Vec<Category> = categories.into_iter().filter(|c| !c.entries.is_empty()).collect();
    let total_bytes = categories.iter().map(|c| c.total_bytes).sum();
    running.sort();
    running.dedup();
    ScanResult { categories, total_bytes, running_browsers: running }
}

/// Every discovered browser base directory — `clean` re-validates against
/// this so it can never be pointed outside a real browser profile tree.
fn allowed_roots() -> Vec<PathBuf> {
    browser_defs().into_iter().flat_map(|d| d.bases).filter(|b| b.is_dir()).collect()
}

fn clean(paths: Vec<String>) -> CleanResult {
    let roots = allowed_roots();
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
                // `full != r` guards the root itself: starts_with() is true
                // for an equal path, which would allow deleting a browser's
                // whole profile base directory instead of one cache subdir.
                roots.iter().any(|root| root.canonicalize().map(|r| full.starts_with(&r) && full != r).unwrap_or(false))
            })
            .unwrap_or(false);

        if !inside_allowed {
            errors.push(format!("{raw}: poza dozwolonymi lokalizacjami — pominięto"));
            continue;
        }

        let (size, _files) = measure(&path);
        let result = if path.is_dir() && !path.is_symlink() { fs::remove_dir_all(&path) } else { fs::remove_file(&path) };
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
