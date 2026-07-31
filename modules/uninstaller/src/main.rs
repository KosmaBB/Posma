//! uninstaller sidecar (Linux only for now): a Revo-Uninstaller-style flow —
//! list installed applications, remove one, then find what it left behind.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"scan"}                                   // blind heuristic leftover scan (legacy/secondary mode)
//!   {"cmd":"clean","paths":["/abs/path", ...]}
//!   {"cmd":"list_apps"}
//!   {"cmd":"app_leftovers","app":{"source":"apt","id":"discord"},"name":"discord"}
//!   {"cmd":"uninstall","app":{"source":"apt","id":"discord"}}
//!
//! App listing merges three sources: apt/dpkg (filtered to packages the
//! user explicitly installed, via /var/lib/apt/extended_states'
//! Auto-Installed flag — dpkg alone lists 2000+ packages on a typical
//! system, almost all of them dependencies nobody would recognize as "a
//! program"), flatpak, and snap.
//!
//! Uninstall is attempted directly with the package manager's own removal
//! command — apt-get/snap need root and will simply fail with a permission
//! error when this app doesn't have it; flatpak has its own polkit prompt
//! for system-wide installs and needs nothing extra for --user installs.
//! This app never wraps any of them in pkexec/sudo itself (same elevation-
//! sequencing rule as everywhere else) — a failed attempt gets a plain
//! error plus the equivalent `sudo ...` command shown for the user to run
//! by hand, same pattern as the health-monitor smartctl install hint.
//!
//! Leftover matching after picking a specific app reuses the same
//! substring-against-known-identifiers approach as the blind scan below,
//! but seeded from that one app's id/name instead of every $PATH binary —
//! much lower false-positive risk since it's confirming "does this look
//! like Discord's data" rather than guessing "is this anything at all".

use std::collections::HashSet;
use std::env;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

#[derive(Deserialize, Clone)]
struct AppRef {
    source: String, // "apt" | "flatpak" | "snap"
    id: String,
    #[serde(default)]
    user_scope: bool,
}

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Scan,
    Clean { paths: Vec<String> },
    ListApps,
    AppLeftovers { app: AppRef, name: String },
    Uninstall { app: AppRef },
}

#[derive(Serialize)]
struct OrphanEntry {
    name: String,
    path: String,
    source: String, // "config" | "cache"
    size_bytes: u64,
    files: u64,
    age_days: Option<u64>,
}

#[derive(Serialize)]
struct ScanResult {
    entries: Vec<OrphanEntry>,
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

/// Directory names under ~/.config or ~/.cache that are system/desktop
/// plumbing, not a standalone application — never flagged even if nothing
/// on $PATH or in .desktop files matches them. Not exhaustive; a deliberate
/// safety net around the binary/desktop heuristic, not a replacement for it.
fn always_safe() -> HashSet<&'static str> {
    [
        "dconf", "pulse", "ibus", "fontconfig", "dbus-1", "gtk-2.0", "gtk-3.0", "gtk-4.0", "menus", "autostart",
        "goa-1.0", "evolution", "geoclue", "xdg-desktop-portal", "systemd", "pipewire", "wireplumber", "libinput",
        "gconf", "kwalletd", "kdedefaults", "plasma-workspace", "baloo", "akonadi", "mesa_shader_cache",
        "event-sound-cache.tdb", "gstreamer-1.0", "ostree", "flatpak", "flatpak-appstream", "tracker3",
        "user-dirs.dirs", "user-dirs.locale", "environment.d", "mimeapps.list", "recently-used.xbel", "thumbnails",
        "trash", "session", "gnome-session", "gnome-control-center", "gnome-shell", "gnome-boxes", "nautilus",
    ]
    .into_iter()
    .collect()
}

fn normalize(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

/// Every regular file name found in a $PATH directory — a strict superset of
/// "installed binaries" is fine here since over-matching only makes the
/// heuristic more conservative (fewer false-positive orphans).
fn path_binaries() -> HashSet<String> {
    let mut out = HashSet::new();
    let Ok(path_var) = env::var("PATH") else { return out };
    for dir in env::split_paths(&path_var) {
        let Ok(read) = fs::read_dir(&dir) else { continue };
        for entry in read.flatten() {
            if let Ok(name) = entry.file_name().into_string() {
                out.insert(normalize(&name));
            }
        }
    }
    out
}

/// Pulls candidate app identifiers out of every .desktop launcher found in
/// the standard XDG locations (including Flatpak/snap export dirs): the
/// Exec= binary's basename, and each dot-separated segment of reverse-DNS
/// style desktop file ids (org.mozilla.firefox.desktop -> "mozilla", "firefox").
fn desktop_identifiers() -> HashSet<String> {
    let mut out = HashSet::new();
    let h = home();
    let dirs = [
        PathBuf::from("/usr/share/applications"),
        PathBuf::from("/usr/local/share/applications"),
        PathBuf::from("/var/lib/snapd/desktop/applications"),
        PathBuf::from("/var/lib/flatpak/exports/share/applications"),
        h.join(".local/share/applications"),
        h.join(".local/share/flatpak/exports/share/applications"),
    ];
    for dir in dirs {
        let Ok(read) = fs::read_dir(&dir) else { continue };
        for entry in read.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("desktop") {
                continue;
            }
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                for segment in stem.split('.') {
                    if segment.len() > 2 {
                        out.insert(normalize(segment));
                    }
                }
            }
            if let Ok(contents) = fs::read_to_string(&path) {
                for line in contents.lines() {
                    if let Some(rest) = line.strip_prefix("Exec=") {
                        if let Some(first_token) = rest.split_whitespace().next() {
                            let bin = Path::new(first_token).file_name().and_then(|f| f.to_str()).unwrap_or(first_token);
                            out.insert(normalize(bin));
                        }
                    }
                }
            }
        }
    }
    out
}

fn is_known(name: &str, known: &HashSet<String>, safe: &HashSet<&str>) -> bool {
    if safe.contains(name) {
        return true;
    }
    let norm = normalize(name);
    if norm.is_empty() {
        return true; // can't reason about it — don't flag
    }
    // A short known identifier (e.g. a 2-letter binary like `cc` or `ln`) is
    // too generic to trust as substring evidence — it'd spuriously "match"
    // almost any directory name and silently suppress real orphans. Require
    // at least 4 characters before a substring match counts.
    known.iter().any(|k| k.len() >= 4 && (k.contains(&norm) || norm.contains(k)))
}

/// Recursively sums size + file count, and the newest mtime seen (used for
/// the "last modified" age shown to the user). Symlinks are never followed.
fn measure(path: &Path) -> (u64, u64, Option<SystemTime>) {
    let Ok(meta) = fs::symlink_metadata(path) else { return (0, 0, None) };
    if meta.file_type().is_symlink() {
        return (0, 0, None);
    }
    if meta.is_file() {
        return (meta.len(), 1, meta.modified().ok());
    }
    let mut size = 0u64;
    let mut files = 0u64;
    let mut newest: Option<SystemTime> = meta.modified().ok();
    if let Ok(read) = fs::read_dir(path) {
        for entry in read.flatten() {
            let (s, f, m) = measure(&entry.path());
            size += s;
            files += f;
            if let Some(m) = m {
                newest = Some(newest.map_or(m, |cur| cur.max(m)));
            }
        }
    }
    (size, files, newest)
}

fn scan_root(root: &Path, source: &str, known: &HashSet<String>, safe: &HashSet<&str>, out: &mut Vec<OrphanEntry>) {
    let Ok(read) = fs::read_dir(root) else { return };
    let now = SystemTime::now();
    for entry in read.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_known(&name, known, safe) {
            continue;
        }
        let (size, files, newest) = measure(&path);
        if size == 0 {
            continue;
        }
        let age_days = newest.and_then(|m| now.duration_since(m).ok()).map(|d| d.as_secs() / 86400);
        out.push(OrphanEntry { name, path: path.to_string_lossy().into_owned(), source: source.into(), size_bytes: size, files, age_days });
    }
}

fn scan() -> ScanResult {
    let h = home();
    let known = {
        let mut k = path_binaries();
        k.extend(desktop_identifiers());
        k
    };
    let safe = always_safe();

    let mut entries = Vec::new();
    scan_root(&h.join(".config"), "config", &known, &safe, &mut entries);
    scan_root(&h.join(".cache"), "cache", &known, &safe, &mut entries);
    entries.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));

    let total_bytes = entries.iter().map(|e| e.size_bytes).sum();
    ScanResult { entries, total_bytes }
}

/// clean() only accepts paths directly inside ~/.config or ~/.cache — the
/// same two roots scan() reads from, re-validated here rather than trusted
/// from the request.
fn allowed_roots() -> Vec<PathBuf> {
    let h = home();
    vec![h.join(".config"), h.join(".cache"), h.join(".local/share"), h.join(".var/app"), h.join("snap")]
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
                roots.iter().any(|root| root.canonicalize().map(|r| full.starts_with(&r) && full != r).unwrap_or(false))
            })
            .unwrap_or(false);

        if !inside_allowed {
            errors.push(format!("{raw}: poza dozwolonymi lokalizacjami — pominięto"));
            continue;
        }

        let (size, _files, _newest) = measure(&path);
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

// ------------------------------------------------------------- app listing

#[derive(Serialize)]
struct InstalledApp {
    id: String,
    name: String,
    version: String,
    source: String, // "apt" | "flatpak" | "snap"
    size_bytes: Option<u64>,
    user_scope: bool,
    description: String,
}

/// Package names apt marked as pulled in automatically (as a dependency),
/// via the same flag `apt-mark showauto`/`showmanual` read. Packages NOT in
/// this set are ones the user asked for by name — the actual "programs".
fn auto_installed_set() -> HashSet<String> {
    let mut set = HashSet::new();
    let Ok(content) = fs::read_to_string("/var/lib/apt/extended_states") else { return set };
    let mut current_pkg: Option<String> = None;
    let mut is_auto = false;
    for line in content.lines() {
        if line.is_empty() {
            if is_auto {
                if let Some(pkg) = current_pkg.take() {
                    set.insert(pkg);
                }
            }
            current_pkg = None;
            is_auto = false;
            continue;
        }
        if let Some(rest) = line.strip_prefix("Package: ") {
            current_pkg = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("Auto-Installed: ") {
            is_auto = rest.trim() == "1";
        }
    }
    if is_auto {
        if let Some(pkg) = current_pkg {
            set.insert(pkg);
        }
    }
    set
}

struct DpkgPkg {
    name: String,
    version: String,
    size_kb: Option<u64>,
    description: String,
    essential: bool,
    priority: String,
}

/// Parses /var/lib/dpkg/status (world-readable, no root needed) for
/// currently-installed packages. Stanzas are blank-line separated; only the
/// short (first-line) description is kept.
fn dpkg_installed() -> Vec<DpkgPkg> {
    let mut out = Vec::new();
    let Ok(content) = fs::read_to_string("/var/lib/dpkg/status") else { return out };
    for stanza in content.split("\n\n") {
        let mut name = None;
        let mut status = None;
        let mut version = None;
        let mut size_kb = None;
        let mut description = None;
        let mut essential = false;
        let mut priority = String::new();
        for line in stanza.lines() {
            if let Some(v) = line.strip_prefix("Package: ") {
                name = Some(v.trim().to_string());
            } else if let Some(v) = line.strip_prefix("Status: ") {
                status = Some(v.trim().to_string());
            } else if let Some(v) = line.strip_prefix("Version: ") {
                version = Some(v.trim().to_string());
            } else if let Some(v) = line.strip_prefix("Installed-Size: ") {
                size_kb = v.trim().parse::<u64>().ok();
            } else if let Some(v) = line.strip_prefix("Description: ") {
                description = Some(v.trim().to_string());
            } else if let Some(v) = line.strip_prefix("Essential: ") {
                essential = v.trim() == "yes";
            } else if let Some(v) = line.strip_prefix("Priority: ") {
                priority = v.trim().to_string();
            }
        }
        let (Some(name), Some(status)) = (name, status) else { continue };
        if !status.contains("install ok installed") {
            continue;
        }
        out.push(DpkgPkg {
            name,
            version: version.unwrap_or_default(),
            size_kb,
            description: description.unwrap_or_default(),
            essential,
            priority,
        });
    }
    out
}

/// Parses a human size like "128.4 MB" / "1.2 GB" into bytes (binary units).
fn parse_size_string(s: &str) -> Option<u64> {
    let s = s.trim();
    let mut parts = s.split_whitespace();
    let num: f64 = parts.next()?.parse().ok()?;
    let unit = parts.next().unwrap_or("B").to_uppercase();
    let mult: f64 = match unit.as_str() {
        "B" => 1.0,
        "KB" | "K" => 1024.0,
        "MB" | "M" => 1024.0 * 1024.0,
        "GB" | "G" => 1024.0 * 1024.0 * 1024.0,
        "TB" | "T" => 1024.0_f64.powi(4),
        _ => return None,
    };
    Some((num * mult) as u64)
}

struct FlatpakApp {
    id: String,
    name: String,
    version: String,
    size_bytes: Option<u64>,
    user_scope: bool,
}

fn flatpak_installed() -> Vec<FlatpakApp> {
    let mut out = Vec::new();
    let Ok(output) = Command::new("flatpak").args(["list", "--app", "--columns=application,name,version,size,installation"]).output() else {
        return out;
    };
    if !output.status.success() {
        return out;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.len() < 5 {
            continue;
        }
        out.push(FlatpakApp {
            id: cols[0].to_string(),
            name: cols[1].to_string(),
            version: cols[2].to_string(),
            size_bytes: parse_size_string(cols[3]),
            user_scope: cols[4].trim().eq_ignore_ascii_case("user"),
        });
    }
    out
}

/// Skips base/runtime snaps ("bare", "core18"/"core20"/..., "snapd" itself)
/// via the Notes column — these are plumbing other snaps run on top of, not
/// something a user would ever pick to "uninstall" as a program, and
/// removing one out from under its dependents would break them.
fn snap_installed() -> Vec<(String, String)> {
    let mut out = Vec::new();
    let Ok(output) = Command::new("snap").args(["list", "--color=never"]).output() else { return out };
    if !output.status.success() {
        return out;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines().skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        let [name, version, ..] = cols[..] else { continue };
        let notes = cols.last().copied().unwrap_or("-");
        if notes.contains("base") || notes.contains("snapd") {
            continue;
        }
        out.push((name.to_string(), version.to_string()));
    }
    out
}

fn list_apps() -> Vec<InstalledApp> {
    let mut out = Vec::new();
    let auto = auto_installed_set();

    for pkg in dpkg_installed() {
        if auto.contains(&pkg.name) {
            continue;
        }
        // Auto-Installed only catches packages pulled in as a dependency —
        // base-system packages that ship as part of the OS's initial
        // package selection (bsdutils, ca-certificates, ...) are marked
        // "manual" by apt even though no human ever chose them, and
        // removing them can genuinely break the system. Confirmed live
        // 2026-07-31: this machine lists 146 "user-installed" apt packages
        // without this filter, many of them base plumbing. dpkg's own
        // Essential/Priority fields are the actual signal for "core system
        // package", so use those instead of trying to guess from the name.
        if pkg.essential || matches!(pkg.priority.as_str(), "required" | "important") {
            continue;
        }
        out.push(InstalledApp {
            id: pkg.name.clone(),
            name: pkg.name,
            version: pkg.version,
            source: "apt".into(),
            size_bytes: pkg.size_kb.map(|k| k * 1024),
            user_scope: false,
            description: pkg.description,
        });
    }
    for app in flatpak_installed() {
        out.push(InstalledApp {
            id: app.id,
            name: app.name,
            version: app.version,
            source: "flatpak".into(),
            size_bytes: app.size_bytes,
            user_scope: app.user_scope,
            description: String::new(),
        });
    }
    for (name, version) in snap_installed() {
        out.push(InstalledApp {
            id: name.clone(),
            name,
            version,
            source: "snap".into(),
            size_bytes: None,
            user_scope: false,
            description: String::new(),
        });
    }

    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

// -------------------------------------------------------- per-app leftovers

/// Candidate substring identifiers: the full normalized id and the full
/// normalized display name only — e.g. "com.discordapp.Discord" + "Discord"
/// -> {"comdiscordappdiscord", "discord"}. Deliberately NOT split into
/// individual word segments ("com", "desktop", "app"...) — normalize()
/// already concatenates dot/dash-separated parts without a separator, so a
/// folder literally named "Discord" or "mozilla" still matches as a
/// substring of the full joined id without needing segments at all, while
/// single generic words no longer can. Confirmed live 2026-07-31, two
/// separate false positives from segment matching: "com" (3 chars) flagged
/// this app's own ~/.local/share/com.posma.app as a Discord leftover, and
/// "desktop" (7 chars — a 4-char floor alone didn't help) flagged an
/// unrelated "GitHub Desktop" folder as a leftover of the snap
/// "chatgpt-desktop".
fn app_identifiers(app: &AppRef, display_name: &str) -> Vec<String> {
    let mut ids = vec![normalize(&app.id), normalize(display_name)];
    ids.retain(|s| s.len() >= 4);
    ids.sort();
    ids.dedup();
    ids
}

/// Same shape as the blind scan's entries, but seeded from one specific
/// app's identifiers rather than "everything not on $PATH" — a targeted
/// confirmation ("does this look like Discord's data") rather than a guess,
/// so ~/.local/share is safe to include here despite being excluded from
/// the blind scan (that root holds too much irreplaceable user data to
/// guess about, but is fine to check against a name we already trust).
fn app_leftovers(app: &AppRef, display_name: &str) -> Vec<OrphanEntry> {
    let ids = app_identifiers(app, display_name);
    let h = home();
    let now = SystemTime::now();
    let mut out = Vec::new();

    // Flatpak and snap both keep each app's real data in a well-defined,
    // exact-match location outside ~/.config/~/.cache/~/.local/share
    // entirely — checked directly by id rather than by the substring
    // heuristic below, since there's nothing to guess here. Confirmed live
    // 2026-07-31: Discord's actual 222MB (flatpak, ~/.var/app) and — far
    // bigger — every snap's real data under ~/snap/<id> (Spotify 4GB,
    // Brave 2.4GB, VS Code 2.1GB on this machine) were entirely invisible
    // to the substring scan below, which only ever looks at the three
    // XDG-style roots.
    let sandbox_root = match app.source.as_str() {
        "flatpak" => Some(h.join(".var/app").join(&app.id)),
        "snap" => Some(h.join("snap").join(&app.id)),
        _ => None,
    };
    if let Some(sandbox_root) = sandbox_root {
        let (size, files, newest) = measure(&sandbox_root);
        if size > 0 {
            let age_days = newest.and_then(|m| now.duration_since(m).ok()).map(|d| d.as_secs() / 86400);
            out.push(OrphanEntry {
                name: app.id.clone(),
                path: sandbox_root.to_string_lossy().into_owned(),
                source: "data".into(),
                size_bytes: size,
                files,
                age_days,
            });
        }
    }

    for (root, source) in [(h.join(".config"), "config"), (h.join(".cache"), "cache"), (h.join(".local/share"), "data")] {
        let Ok(read) = fs::read_dir(&root) else { continue };
        for entry in read.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            if !meta.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let norm = normalize(&name);
            if norm.is_empty() || !ids.iter().any(|id| norm.contains(id) || id.contains(&norm)) {
                continue;
            }
            let (size, files, newest) = measure(&path);
            if size == 0 {
                continue;
            }
            let age_days = newest.and_then(|m| now.duration_since(m).ok()).map(|d| d.as_secs() / 86400);
            out.push(OrphanEntry { name, path: path.to_string_lossy().into_owned(), source: source.into(), size_bytes: size, files, age_days });
        }
    }
    out.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    out
}

// ------------------------------------------------------------- uninstall

#[derive(Serialize)]
struct UninstallResult {
    success: bool,
    output: String,
    error: Option<String>,
    /// Display-only equivalent `sudo ...` command — never run by this app.
    install_hint: Option<String>,
}

fn uninstall(app: AppRef) -> UninstallResult {
    let (program, args): (&str, Vec<String>) = match app.source.as_str() {
        "apt" => ("apt-get", vec!["remove".into(), "-y".into(), app.id.clone()]),
        "flatpak" => {
            let mut a = vec!["uninstall".into(), "-y".into()];
            if app.user_scope {
                a.push("--user".into());
            }
            a.push(app.id.clone());
            ("flatpak", a)
        }
        "snap" => ("snap", vec!["remove".into(), app.id.clone()]),
        _ => {
            return UninstallResult { success: false, output: String::new(), error: Some("nieznane źródło pakietu".into()), install_hint: None };
        }
    };
    // flatpak has its own polkit-based privilege escalation for system-wide
    // installs — prefixing `sudo` isn't the idiomatic suggestion there the
    // way it is for apt/snap, which always need it.
    let manual_cmd = if program == "flatpak" {
        format!("flatpak {}", args.join(" "))
    } else {
        format!("sudo {program} {}", args.join(" "))
    };

    match Command::new(program).args(&args).output() {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
            UninstallResult { success: true, output: stdout, error: None, install_hint: None }
        }
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            UninstallResult {
                success: false,
                output: stdout,
                error: Some(if stderr.is_empty() { "polecenie zakończyło się błędem".into() } else { stderr }),
                install_hint: Some(manual_cmd),
            }
        }
        Err(e) => UninstallResult { success: false, output: String::new(), error: Some(e.to_string()), install_hint: Some(manual_cmd) },
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
            Ok(Request::Clean { paths }) => serde_json::to_string(&ok(clean(paths))),
            Ok(Request::ListApps) => serde_json::to_string(&ok(list_apps())),
            Ok(Request::AppLeftovers { app, name }) => serde_json::to_string(&ok(app_leftovers(&app, &name))),
            Ok(Request::Uninstall { app }) => serde_json::to_string(&ok(uninstall(app))),
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
