//! desktop-theme sidecar: reads and applies the desktop's visual settings —
//! GTK theme, icon theme, cursor theme and interface fonts — and installs
//! themes and fonts dropped in from a folder.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"scan"}
//!   {"cmd":"apply","changes":{"gtk_theme":"Yaru-dark", ...}}
//!   {"cmd":"install_theme","source_dir":"/abs/path","name":null}
//!   {"cmd":"install_font","path":"/abs/path/font.ttf"}
//!   {"cmd":"list_presets"} | {"cmd":"save_preset","name":"..."}
//!   {"cmd":"load_preset","name":"..."} | {"cmd":"delete_preset","name":"..."}
//!
//! Nothing here needs elevation. Every write lands under $HOME —
//! ~/.themes, ~/.icons, ~/.local/share/fonts and the desktop's own settings
//! store — which is also why the module declares only `fs-user`.
//!
//! GNOME and Plasma are not two operating systems, so they are a runtime
//! branch behind a trait rather than a compile-time one: a single binary has
//! to serve whichever session it is started in.

use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

// ============================================================== protocol

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Scan,
    Apply {
        changes: Changes,
    },
    InstallTheme {
        source_dir: String,
        /// Folder name to install under. Defaults to the source's own name.
        #[serde(default)]
        name: Option<String>,
    },
    InstallFont {
        path: String,
    },
    ListPresets,
    SavePreset {
        name: String,
    },
    LoadPreset {
        name: String,
    },
    DeletePreset {
        name: String,
    },
}

/// Every field optional: the UI sends only what the user actually changed,
/// so an untouched setting is never rewritten with a stale value.
#[derive(Deserialize, Serialize, Default, Clone)]
struct Changes {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    gtk_theme: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    icon_theme: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cursor_theme: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    font: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    monospace_font: Option<String>,
    /// "default" | "prefer-dark" | "prefer-light"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    color_scheme: Option<String>,
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

// ================================================================ shapes

#[derive(Serialize, Default, Clone)]
struct Current {
    gtk_theme: String,
    icon_theme: String,
    cursor_theme: String,
    font: String,
    monospace_font: String,
    color_scheme: String,
}

#[derive(Serialize)]
struct ThemeEntry {
    name: String,
    /// Directory it was found in, so the UI can show user-installed themes
    /// separately from the ones the distribution ships.
    source: String,
    user_installed: bool,
}

#[derive(Serialize)]
struct ScanResult {
    desktop: &'static str,
    desktop_name: String,
    /// False when the session is one this module cannot drive, or when the
    /// tools it needs are missing. The UI disables editing rather than
    /// letting the user press buttons that silently do nothing.
    supported: bool,
    /// Present when `supported` is false — says why, in the user's language.
    unsupported_reason: Option<String>,
    /// Whether this session can switch between a light and a dark scheme at
    /// all. Not every GNOME install ships the `color-scheme` key even at
    /// version 46, and Plasma needs a helper that may not be installed, so
    /// the UI asks rather than assuming.
    color_scheme_supported: bool,
    current: Current,
    gtk_themes: Vec<ThemeEntry>,
    icon_themes: Vec<ThemeEntry>,
    cursor_themes: Vec<ThemeEntry>,
    fonts: Vec<String>,
    presets: Vec<String>,
}

#[derive(Serialize)]
struct ApplyResult {
    success: bool,
    applied: Vec<String>,
    failed: Vec<String>,
}

#[derive(Serialize)]
struct InstallResult {
    success: bool,
    name: String,
    kind: String,
    files: usize,
    destination: String,
}

// ============================================================ desktop API

/// What a desktop environment has to be able to do for this module.
///
/// Both implementations shell out to the session's own configuration tool
/// rather than editing its files directly: a running desktop caches its
/// settings in memory and a file written behind its back is either ignored
/// or clobbered on logout.
trait Desktop {
    fn id(&self) -> &'static str;
    fn name(&self) -> String;
    /// Whether the tool this implementation drives is actually installed.
    fn available(&self) -> bool;
    fn read(&self) -> Current;
    /// Whether a light/dark switch is available in this session.
    fn supports_color_scheme(&self) -> bool;
    /// Returns the human-readable name of each setting that was applied.
    fn apply(&self, changes: &Changes) -> ApplyResult;
}

fn have(cmd: &str) -> bool {
    Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {cmd}"))
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn run(cmd: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new(cmd)
        .args(args)
        .output()
        .map_err(|e| format!("{cmd}: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        // Some tools report failure with nothing on stderr; an empty error
        // string reads as success further up, so give it something.
        Err(if stderr.is_empty() { format!("{cmd} zakończone błędem") } else { stderr })
    }
}

// -------------------------------------------------------------- GNOME

struct Gnome;

impl Gnome {
    const IFACE: &'static str = "org.gnome.desktop.interface";

    /// gsettings quotes its string values; the quotes are not part of them.
    fn get(key: &str) -> String {
        run("gsettings", &["get", Self::IFACE, key])
            .map(|v| v.trim_matches('\'').trim_matches('"').to_string())
            .unwrap_or_default()
    }

    fn set(key: &str, value: &str) -> Result<(), String> {
        run("gsettings", &["set", Self::IFACE, key, value]).map(|_| ())
    }

    /// Exact-match against the schema's key list. A substring test would
    /// accept the deprecated `gtk-color-scheme` as if it were the modern
    /// `color-scheme`, which reads as supported and then fails on write.
    fn has_key(key: &str) -> bool {
        run("gsettings", &["list-keys", Self::IFACE])
            .map(|out| out.lines().any(|k| k.trim() == key))
            .unwrap_or(false)
    }
}

impl Desktop for Gnome {
    fn id(&self) -> &'static str {
        "gnome"
    }

    fn name(&self) -> String {
        "GNOME".into()
    }

    fn available(&self) -> bool {
        have("gsettings")
    }

    fn supports_color_scheme(&self) -> bool {
        Self::has_key("color-scheme")
    }

    fn read(&self) -> Current {
        Current {
            gtk_theme: Self::get("gtk-theme"),
            icon_theme: Self::get("icon-theme"),
            cursor_theme: Self::get("cursor-theme"),
            font: Self::get("font-name"),
            monospace_font: Self::get("monospace-font-name"),
            color_scheme: Self::get("color-scheme"),
        }
    }

    fn apply(&self, changes: &Changes) -> ApplyResult {
        let mut applied = Vec::new();
        let mut failed = Vec::new();

        let jobs: [(&str, &Option<String>, &str); 6] = [
            ("gtk-theme", &changes.gtk_theme, "Motyw GTK"),
            ("icon-theme", &changes.icon_theme, "Ikony"),
            ("cursor-theme", &changes.cursor_theme, "Kursor"),
            ("font-name", &changes.font, "Czcionka interfejsu"),
            ("monospace-font-name", &changes.monospace_font, "Czcionka o stałej szerokości"),
            ("color-scheme", &changes.color_scheme, "Tryb jasny/ciemny"),
        ];

        for (key, value, label) in jobs {
            let Some(v) = value else { continue };
            if key == "color-scheme" && !Self::has_key(key) {
                failed.push(format!("{label}: ta wersja GNOME nie obsługuje tego ustawienia"));
                continue;
            }
            match Self::set(key, v) {
                Ok(()) => applied.push(label.to_string()),
                Err(e) => failed.push(format!("{label}: {e}")),
            }
        }

        ApplyResult { success: failed.is_empty(), applied, failed }
    }
}

// ------------------------------------------------------------- Plasma

/// KDE Plasma support is written against the documented behaviour of
/// `kwriteconfig`/`kreadconfig` and the `plasma-apply-*` helpers, but it has
/// never been run on a Plasma session — this project is developed on GNOME.
/// It is wired up rather than stubbed so that a Plasma user gets something
/// that can work, and `available()` reports honestly when the tools are
/// missing instead of failing halfway through.
struct Plasma {
    /// Plasma 6 renamed the binaries with a version suffix; whichever is
    /// present is used, and neither being present means unsupported.
    write: &'static str,
    read: &'static str,
}

impl Plasma {
    fn detect() -> Option<Self> {
        if have("kwriteconfig6") && have("kreadconfig6") {
            Some(Plasma { write: "kwriteconfig6", read: "kreadconfig6" })
        } else if have("kwriteconfig5") && have("kreadconfig5") {
            Some(Plasma { write: "kwriteconfig5", read: "kreadconfig5" })
        } else {
            None
        }
    }

    fn get(&self, group: &str, key: &str) -> String {
        run(self.read, &["--file", "kdeglobals", "--group", group, "--key", key]).unwrap_or_default()
    }

    fn set(&self, group: &str, key: &str, value: &str) -> Result<(), String> {
        run(self.write, &["--file", "kdeglobals", "--group", group, "--key", key, value]).map(|_| ())
    }
}

impl Desktop for Plasma {
    fn id(&self) -> &'static str {
        "plasma"
    }

    fn name(&self) -> String {
        "KDE Plasma".into()
    }

    fn available(&self) -> bool {
        have(self.write) && have(self.read)
    }

    fn supports_color_scheme(&self) -> bool {
        have("plasma-apply-colorscheme")
    }

    fn read(&self) -> Current {
        Current {
            gtk_theme: self.get("KDE", "widgetStyle"),
            icon_theme: self.get("Icons", "Theme"),
            cursor_theme: self.get("General", "cursorTheme"),
            font: self.get("General", "font"),
            monospace_font: self.get("General", "fixed"),
            color_scheme: self.get("General", "ColorScheme"),
        }
    }

    fn apply(&self, changes: &Changes) -> ApplyResult {
        let mut applied = Vec::new();
        let mut failed = Vec::new();

        let jobs: [(&str, &str, &Option<String>, &str); 5] = [
            ("KDE", "widgetStyle", &changes.gtk_theme, "Styl widgetów"),
            ("Icons", "Theme", &changes.icon_theme, "Ikony"),
            ("General", "cursorTheme", &changes.cursor_theme, "Kursor"),
            ("General", "font", &changes.font, "Czcionka interfejsu"),
            ("General", "fixed", &changes.monospace_font, "Czcionka o stałej szerokości"),
        ];

        for (group, key, value, label) in jobs {
            let Some(v) = value else { continue };
            match self.set(group, key, v) {
                Ok(()) => applied.push(label.to_string()),
                Err(e) => failed.push(format!("{label}: {e}")),
            }
        }

        // Colour schemes are a whole-scheme swap on Plasma, not a key.
        if let Some(scheme) = &changes.color_scheme {
            if have("plasma-apply-colorscheme") {
                match run("plasma-apply-colorscheme", &[scheme]) {
                    Ok(_) => applied.push("Schemat kolorów".into()),
                    Err(e) => failed.push(format!("Schemat kolorów: {e}")),
                }
            } else {
                failed.push("Schemat kolorów: brak plasma-apply-colorscheme".into());
            }
        }

        ApplyResult { success: failed.is_empty(), applied, failed }
    }
}

// ------------------------------------------------------------ unknown

/// Anything this module cannot drive. Reads nothing and applies nothing,
/// rather than guessing at another desktop's configuration format.
struct Unknown(String);

impl Desktop for Unknown {
    fn id(&self) -> &'static str {
        "unknown"
    }

    fn name(&self) -> String {
        self.0.clone()
    }

    fn available(&self) -> bool {
        false
    }

    fn supports_color_scheme(&self) -> bool {
        false
    }

    fn read(&self) -> Current {
        Current::default()
    }

    fn apply(&self, _changes: &Changes) -> ApplyResult {
        ApplyResult {
            success: false,
            applied: Vec::new(),
            failed: vec!["To środowisko graficzne nie jest obsługiwane".into()],
        }
    }
}

/// Picks an implementation from the session's own advertisement of itself.
/// XDG_CURRENT_DESKTOP is colon-separated and often prefixed by the distro
/// ("ubuntu:GNOME"), so it is matched case-insensitively on substrings.
fn detect_desktop() -> Box<dyn Desktop> {
    let raw = env::var("XDG_CURRENT_DESKTOP")
        .or_else(|_| env::var("DESKTOP_SESSION"))
        .unwrap_or_default();
    let lower = raw.to_lowercase();

    if lower.contains("gnome") || lower.contains("unity") || lower.contains("cinnamon") {
        Box::new(Gnome)
    } else if lower.contains("kde") || lower.contains("plasma") {
        match Plasma::detect() {
            Some(p) => Box::new(p),
            None => Box::new(Unknown("KDE Plasma (brak narzędzi kwriteconfig)".into())),
        }
    } else if lower.is_empty() {
        Box::new(Unknown("nie wykryto środowiska graficznego".into()))
    } else {
        Box::new(Unknown(raw))
    }
}

// =========================================================== discovery

fn home() -> PathBuf {
    env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("/tmp"))
}

/// Directories a desktop looks in for themes of a given kind, user-owned
/// ones first so a local override shadows the system copy in the listing.
fn theme_dirs(kind: &str) -> Vec<(PathBuf, bool)> {
    let h = home();
    match kind {
        "icons" => vec![
            (h.join(".icons"), true),
            (h.join(".local/share/icons"), true),
            (PathBuf::from("/usr/share/icons"), false),
        ],
        _ => vec![
            (h.join(".themes"), true),
            (h.join(".local/share/themes"), true),
            (PathBuf::from("/usr/share/themes"), false),
        ],
    }
}

/// A GTK theme directory is one that actually contains a gtk-* subfolder;
/// an icon theme is one with an index.theme. Listing every subdirectory
/// instead would offer the user names that do not resolve to anything.
fn looks_like_gtk_theme(dir: &Path) -> bool {
    fs::read_dir(dir)
        .map(|rd| {
            rd.flatten().any(|e| {
                e.file_name().to_string_lossy().starts_with("gtk-") && e.path().is_dir()
            })
        })
        .unwrap_or(false)
}

fn looks_like_icon_theme(dir: &Path) -> bool {
    dir.join("index.theme").is_file()
}

fn looks_like_cursor_theme(dir: &Path) -> bool {
    dir.join("cursors").is_dir()
}

fn collect(kind: &str, matches: fn(&Path) -> bool) -> Vec<ThemeEntry> {
    let mut seen: BTreeMap<String, ThemeEntry> = BTreeMap::new();

    for (dir, user_installed) in theme_dirs(kind) {
        let Ok(read) = fs::read_dir(&dir) else { continue };
        for entry in read.flatten() {
            let path = entry.path();
            if !path.is_dir() || !matches(&path) {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            // First writer wins, and user directories are visited first, so
            // a local theme keeps its "installed by you" marking.
            seen.entry(name.clone()).or_insert(ThemeEntry {
                name,
                source: dir.to_string_lossy().into_owned(),
                user_installed,
            });
        }
    }

    seen.into_values().collect()
}

/// Installed font families, via fontconfig so the list matches what the
/// desktop itself will offer.
fn font_families() -> Vec<String> {
    let Ok(out) = run("fc-list", &[":", "family"]) else { return Vec::new() };
    let mut families: Vec<String> = out
        .lines()
        // fc-list prints comma-separated aliases; the first is the canonical
        // family name and the rest are localised or legacy spellings.
        .filter_map(|line| line.split(',').next())
        .map(|f| f.trim().to_string())
        .filter(|f| !f.is_empty())
        .collect();
    families.sort_unstable();
    families.dedup();
    families
}

// ============================================================== presets

fn presets_dir() -> PathBuf {
    home().join(".local/share/posma/desktop-presets")
}

/// Same rule as every other user-supplied name in this codebase: no path
/// separators or traversal, so it can only resolve to a file directly
/// inside presets_dir().
fn is_safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 60
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ' '))
}

fn preset_path(name: &str) -> Result<PathBuf, String> {
    if !is_safe_name(name) {
        return Err("Niedozwolona nazwa presetu".into());
    }
    Ok(presets_dir().join(format!("{name}.json")))
}

fn list_presets() -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(presets_dir())
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| {
                    let n = e.file_name().to_string_lossy().into_owned();
                    n.strip_suffix(".json").map(|s| s.to_string())
                })
                .collect()
        })
        .unwrap_or_default();
    names.sort_unstable();
    names
}

// ============================================================ installing

/// True when both paths resolve to the same directory.
///
/// This exists because of a real incident: an earlier module copied a theme
/// onto itself, and `fs::copy` truncates its destination before reading the
/// source, so every file was zeroed. Both the whole-directory check and the
/// per-file one below are needed — the first catches the obvious case, the
/// second catches a source nested inside its own destination.
fn is_same_file(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

fn copy_dir(src: &Path, dst: &Path, count: &mut usize) -> io::Result<()> {
    if is_same_file(src, dst) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "źródło i cel to ten sam folder",
        ));
    }
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)?.flatten() {
        let file_type = entry.file_type()?;
        let dest_path = dst.join(entry.file_name());
        if file_type.is_symlink() {
            continue;
        } else if file_type.is_dir() {
            copy_dir(&entry.path(), &dest_path, count)?;
        } else if file_type.is_file() && !is_same_file(&entry.path(), &dest_path) {
            fs::copy(entry.path(), &dest_path)?;
            *count += 1;
        }
    }
    Ok(())
}

/// Decides what a folder is by what it contains, so the user does not have
/// to tell the module whether they picked a GTK theme or an icon set.
fn classify(dir: &Path) -> Option<(&'static str, PathBuf)> {
    let h = home();
    if looks_like_gtk_theme(dir) {
        Some(("theme", h.join(".themes")))
    } else if looks_like_cursor_theme(dir) {
        Some(("cursor", h.join(".icons")))
    } else if looks_like_icon_theme(dir) {
        Some(("icons", h.join(".icons")))
    } else {
        None
    }
}

fn install_theme(source_dir: &str, name: Option<String>) -> Result<InstallResult, String> {
    let src = PathBuf::from(source_dir);
    if !src.is_dir() {
        return Err("Wskazana ścieżka nie jest folderem".into());
    }

    let Some((kind, dest_root)) = classify(&src) else {
        return Err(
            "To nie wygląda na motyw — brak podfolderu gtk-*, pliku index.theme ani folderu cursors".into(),
        );
    };

    let folder_name = match name {
        Some(n) => n,
        None => src
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .ok_or("Nie udało się ustalić nazwy motywu")?,
    };

    if !is_safe_name(&folder_name) {
        return Err("Niedozwolona nazwa motywu".into());
    }

    let dest = dest_root.join(&folder_name);
    let mut files = 0usize;
    copy_dir(&src, &dest, &mut files).map_err(|e| e.to_string())?;

    Ok(InstallResult {
        success: true,
        name: folder_name,
        kind: kind.into(),
        files,
        destination: dest.to_string_lossy().into_owned(),
    })
}

const FONT_EXTENSIONS: [&str; 5] = ["ttf", "otf", "ttc", "woff", "woff2"];

fn install_font(path: &str) -> Result<InstallResult, String> {
    let src = PathBuf::from(path);
    if !src.is_file() {
        return Err("Wskazana ścieżka nie jest plikiem".into());
    }

    let ext = src
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !FONT_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("Nieobsługiwany format czcionki: .{ext}"));
    }

    let file_name = src
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or("Nie udało się ustalić nazwy pliku")?;

    let dest_dir = home().join(".local/share/fonts");
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let dest = dest_dir.join(&file_name);

    if is_same_file(&src, &dest) {
        return Err("Ta czcionka jest już zainstalowana w tym miejscu".into());
    }

    fs::copy(&src, &dest).map_err(|e| e.to_string())?;

    // Without this the font exists on disk but no running application can
    // see it until the cache is rebuilt, which reads as the install failing.
    let _ = run("fc-cache", &["-f", dest_dir.to_string_lossy().as_ref()]);

    Ok(InstallResult {
        success: true,
        name: file_name,
        kind: "font".into(),
        files: 1,
        destination: dest.to_string_lossy().into_owned(),
    })
}

// ================================================================= main

fn scan(desktop: &dyn Desktop) -> ScanResult {
    let supported = desktop.available();
    let unsupported_reason = if supported {
        None
    } else if desktop.id() == "unknown" {
        Some(format!("Środowisko „{}” nie jest obsługiwane przez ten moduł", desktop.name()))
    } else {
        Some(format!("Brak narzędzi konfiguracyjnych dla {}", desktop.name()))
    };

    ScanResult {
        desktop: desktop.id(),
        desktop_name: desktop.name(),
        supported,
        unsupported_reason,
        color_scheme_supported: supported && desktop.supports_color_scheme(),
        current: if supported { desktop.read() } else { Current::default() },
        gtk_themes: collect("themes", looks_like_gtk_theme),
        icon_themes: collect("icons", looks_like_icon_theme),
        cursor_themes: collect("icons", looks_like_cursor_theme),
        fonts: font_families(),
        presets: list_presets(),
    }
}

fn handle(request: Request, desktop: &dyn Desktop) -> serde_json::Result<String> {
    match request {
        Request::Scan => serde_json::to_string(&ok(scan(desktop))),

        Request::Apply { changes } => serde_json::to_string(&ok(desktop.apply(&changes))),

        Request::InstallTheme { source_dir, name } => match install_theme(&source_dir, name) {
            Ok(result) => serde_json::to_string(&ok(result)),
            Err(e) => serde_json::to_string(&err::<InstallResult>(e)),
        },

        Request::InstallFont { path } => match install_font(&path) {
            Ok(result) => serde_json::to_string(&ok(result)),
            Err(e) => serde_json::to_string(&err::<InstallResult>(e)),
        },

        Request::ListPresets => serde_json::to_string(&ok(list_presets())),

        Request::SavePreset { name } => {
            let current = desktop.read();
            let body = Changes {
                gtk_theme: Some(current.gtk_theme),
                icon_theme: Some(current.icon_theme),
                cursor_theme: Some(current.cursor_theme),
                font: Some(current.font),
                monospace_font: Some(current.monospace_font),
                color_scheme: Some(current.color_scheme),
            };
            match preset_path(&name).and_then(|p| {
                fs::create_dir_all(presets_dir())
                    .and_then(|_| fs::write(&p, serde_json::to_string_pretty(&body).unwrap_or_default()))
                    .map_err(|e| e.to_string())
            }) {
                Ok(()) => serde_json::to_string(&ok(list_presets())),
                Err(e) => serde_json::to_string(&err::<Vec<String>>(e)),
            }
        }

        Request::LoadPreset { name } => {
            let loaded = preset_path(&name).and_then(|p| {
                fs::read_to_string(p).map_err(|e| e.to_string()).and_then(|raw| {
                    serde_json::from_str::<Changes>(&raw).map_err(|e| e.to_string())
                })
            });
            match loaded {
                Ok(changes) => serde_json::to_string(&ok(desktop.apply(&changes))),
                Err(e) => serde_json::to_string(&err::<ApplyResult>(e)),
            }
        }

        Request::DeletePreset { name } => match preset_path(&name) {
            Ok(path) => {
                let _ = fs::remove_file(path);
                serde_json::to_string(&ok(list_presets()))
            }
            Err(e) => serde_json::to_string(&err::<Vec<String>>(e)),
        },
    }
}

fn main() {
    let desktop = detect_desktop();
    let stdin = io::stdin();
    let mut line = String::new();

    if stdin.lock().read_line(&mut line).is_err() || line.trim().is_empty() {
        return;
    }

    let response = match serde_json::from_str::<Request>(&line) {
        Ok(request) => handle(request, desktop.as_ref())
            .unwrap_or_else(|e| format!(r#"{{"ok":false,"error":"{e}"}}"#)),
        Err(e) => format!(r#"{{"ok":false,"error":"Nieprawidłowe żądanie: {e}"}}"#),
    };

    let mut stdout = io::stdout();
    let _ = writeln!(stdout, "{response}");
    let _ = stdout.flush();
}
