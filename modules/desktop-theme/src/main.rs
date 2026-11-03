//! desktop-theme sidecar: reads and applies GTK/icon/cursor themes and
//! interface fonts, and installs a theme or font from a folder.
//!
//! Protocol: scan | apply | install_theme | install_font |
//! list_presets | save_preset | load_preset | delete_preset
//!
//! No elevation: every write lands under $HOME, hence `fs-user` only.
//! GNOME and Plasma are a runtime branch behind a trait, not a compile-time
//! one — one binary serves whichever session it starts in.

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

// ---------------------------------------------------------- gsettings

/// Where one setting lives: schema and key. `None` where the desktop has no
/// such setting at all.
type Key = Option<(&'static str, &'static str)>;

const GNOME_IFACE: &str = "org.gnome.desktop.interface";

/// GNOME and the desktops built on its settings stack. Budgie and Pantheon
/// read GNOME's own keys; Cinnamon and MATE forked the schema, so each
/// desktop names where its keys are.
struct Gsettings {
    id: &'static str,
    name: &'static str,
    gtk_theme: Key,
    icon_theme: Key,
    cursor_theme: Key,
    font: Key,
    monospace_font: Key,
    color_scheme: Key,
}

impl Gsettings {
    fn gnome(id: &'static str, name: &'static str) -> Self {
        Gsettings {
            id,
            name,
            gtk_theme: Some((GNOME_IFACE, "gtk-theme")),
            icon_theme: Some((GNOME_IFACE, "icon-theme")),
            cursor_theme: Some((GNOME_IFACE, "cursor-theme")),
            font: Some((GNOME_IFACE, "font-name")),
            monospace_font: Some((GNOME_IFACE, "monospace-font-name")),
            color_scheme: Some((GNOME_IFACE, "color-scheme")),
        }
    }

    /// Cinnamon's settings module writes its own schema; the monospace font
    /// it still takes from GNOME's, and Mint's light/dark switch is the
    /// X-Apps portal's.
    fn cinnamon() -> Self {
        const IFACE: &str = "org.cinnamon.desktop.interface";
        Gsettings {
            id: "cinnamon",
            name: "Cinnamon",
            gtk_theme: Some((IFACE, "gtk-theme")),
            icon_theme: Some((IFACE, "icon-theme")),
            cursor_theme: Some((IFACE, "cursor-theme")),
            font: Some((IFACE, "font-name")),
            monospace_font: Some((GNOME_IFACE, "monospace-font-name")),
            color_scheme: Some(("org.x.apps.portal", "color-scheme")),
        }
    }

    fn mate() -> Self {
        const IFACE: &str = "org.mate.interface";
        Gsettings {
            id: "mate",
            name: "MATE",
            gtk_theme: Some((IFACE, "gtk-theme")),
            icon_theme: Some((IFACE, "icon-theme")),
            cursor_theme: Some(("org.mate.peripherals-mouse", "cursor-theme")),
            font: Some((IFACE, "font-name")),
            monospace_font: Some((IFACE, "monospace-font-name")),
            color_scheme: None,
        }
    }

    /// gsettings quotes its string values; the quotes are not part of them.
    fn get(key: Key) -> String {
        let Some((schema, key)) = key else { return String::new() };
        run("gsettings", &["get", schema, key])
            .map(|v| v.trim_matches('\'').trim_matches('"').to_string())
            .unwrap_or_default()
    }

    /// Exact-match against the schema's key list. A substring test would
    /// accept the deprecated `gtk-color-scheme` as if it were the modern
    /// `color-scheme`, which reads as supported and then fails on write.
    fn has_key(key: Key) -> bool {
        let Some((schema, key)) = key else { return false };
        run("gsettings", &["list-keys", schema])
            .map(|out| out.lines().any(|k| k.trim() == key))
            .unwrap_or(false)
    }
}

impl Desktop for Gsettings {
    fn id(&self) -> &'static str {
        self.id
    }

    fn name(&self) -> String {
        self.name.into()
    }

    fn available(&self) -> bool {
        have("gsettings")
    }

    fn supports_color_scheme(&self) -> bool {
        Self::has_key(self.color_scheme)
    }

    fn read(&self) -> Current {
        Current {
            gtk_theme: Self::get(self.gtk_theme),
            icon_theme: Self::get(self.icon_theme),
            cursor_theme: Self::get(self.cursor_theme),
            font: Self::get(self.font),
            monospace_font: Self::get(self.monospace_font),
            color_scheme: Self::get(self.color_scheme),
        }
    }

    fn apply(&self, changes: &Changes) -> ApplyResult {
        let mut applied = Vec::new();
        let mut failed = Vec::new();

        let jobs: [(Key, &Option<String>, &str); 6] = [
            (self.gtk_theme, &changes.gtk_theme, "Motyw GTK"),
            (self.icon_theme, &changes.icon_theme, "Ikony"),
            (self.cursor_theme, &changes.cursor_theme, "Kursor"),
            (self.font, &changes.font, "Czcionka interfejsu"),
            (self.monospace_font, &changes.monospace_font, "Czcionka o stałej szerokości"),
            (self.color_scheme, &changes.color_scheme, "Tryb jasny/ciemny"),
        ];

        for (key, value, label) in jobs {
            let Some(v) = value else { continue };
            let Some((schema, name)) = key.filter(|_| Self::has_key(key)) else {
                failed.push(format!("{label}: ta wersja {} nie obsługuje tego ustawienia", self.name));
                continue;
            };
            match run("gsettings", &["set", schema, name, v]) {
                Ok(_) => applied.push(label.to_string()),
                Err(e) => failed.push(format!("{label}: {e}")),
            }
        }

        ApplyResult { success: failed.is_empty(), applied, failed }
    }
}

// --------------------------------------------------------------- Xfce

/// Xfce keeps the same settings in its own store, behind xfconf-query; its
/// settings daemon hands them on to running GTK applications. It has no
/// light/dark switch of its own.
struct Xfce;

impl Xfce {
    const PROPS: [(&'static str, &'static str); 5] = [
        ("/Net/ThemeName", "Motyw GTK"),
        ("/Net/IconThemeName", "Ikony"),
        ("/Gtk/CursorThemeName", "Kursor"),
        ("/Gtk/FontName", "Czcionka interfejsu"),
        ("/Gtk/MonospaceFontName", "Czcionka o stałej szerokości"),
    ];

    fn get(prop: &str) -> String {
        run("xfconf-query", &["-c", "xsettings", "-p", prop]).unwrap_or_default()
    }
}

impl Desktop for Xfce {
    fn id(&self) -> &'static str {
        "xfce"
    }

    fn name(&self) -> String {
        "Xfce".into()
    }

    fn available(&self) -> bool {
        have("xfconf-query")
    }

    fn supports_color_scheme(&self) -> bool {
        false
    }

    fn read(&self) -> Current {
        let [gtk, icons, cursor, font, mono] = Self::PROPS.map(|(prop, _)| Self::get(prop));
        Current { gtk_theme: gtk, icon_theme: icons, cursor_theme: cursor, font, monospace_font: mono, color_scheme: String::new() }
    }

    fn apply(&self, changes: &Changes) -> ApplyResult {
        let mut applied = Vec::new();
        let mut failed = Vec::new();
        let values = [&changes.gtk_theme, &changes.icon_theme, &changes.cursor_theme, &changes.font, &changes.monospace_font];
        for ((prop, label), value) in Self::PROPS.into_iter().zip(values) {
            let Some(v) = value else { continue };
            // -n creates the property where the session never set it.
            match run("xfconf-query", &["-c", "xsettings", "-p", prop, "-n", "-t", "string", "-s", v]) {
                Ok(_) => applied.push(label.to_string()),
                Err(e) => failed.push(format!("{label}: {e}")),
            }
        }
        if changes.color_scheme.is_some() {
            failed.push("Tryb jasny/ciemny: Xfce nie ma tego ustawienia".into());
        }
        ApplyResult { success: failed.is_empty(), applied, failed }
    }
}

// ------------------------------------------------------------- Plasma

/// KDE Plasma, through `kwriteconfig`/`kreadconfig` and the `plasma-apply-*`
/// helpers. Reading was checked on a Plasma 6 session (CachyOS); applying
/// has not been run there yet. `available()` reports honestly when the
/// tools are missing instead of failing halfway through.
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
        self.get_in("kdeglobals", group, key)
    }

    fn get_in(&self, file: &str, group: &str, key: &str) -> String {
        run(self.read, &["--file", file, "--group", group, "--key", key]).unwrap_or_default()
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
            // The cursor is the mouse settings' own, not kdeglobals'.
            cursor_theme: self.get_in("kcminputrc", "Mouse", "cursorTheme"),
            font: self.get("General", "font"),
            monospace_font: self.get("General", "fixed"),
            color_scheme: self.get("General", "ColorScheme"),
        }
    }

    fn apply(&self, changes: &Changes) -> ApplyResult {
        let mut applied = Vec::new();
        let mut failed = Vec::new();

        let jobs: [(&str, &str, &Option<String>, &str); 4] = [
            ("KDE", "widgetStyle", &changes.gtk_theme, "Styl widgetów"),
            ("Icons", "Theme", &changes.icon_theme, "Ikony"),
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

        // The helper also switches the running session; the key alone
        // waits for the next login.
        if let Some(cursor) = &changes.cursor_theme {
            let done = if have("plasma-apply-cursortheme") {
                run("plasma-apply-cursortheme", &[cursor]).map(|_| ())
            } else {
                run(self.write, &["--file", "kcminputrc", "--group", "Mouse", "--key", "cursorTheme", cursor]).map(|_| ())
            };
            match done {
                Ok(()) => applied.push("Kursor".into()),
                Err(e) => failed.push(format!("Kursor: {e}")),
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

/// Picks an implementation for the desktop the profile names: the session's
/// own advertisement of itself, unless the user corrected it at onboarding.
fn detect_desktop() -> Box<dyn Desktop> {
    desktop_for(distro::desktop())
}

fn desktop_for(id: Option<&str>) -> Box<dyn Desktop> {
    match id {
        Some("gnome") => Box::new(Gsettings::gnome("gnome", "GNOME")),
        Some("budgie") => Box::new(Gsettings::gnome("budgie", "Budgie")),
        // elementary's light/dark switch is its settings daemon's, not
        // GNOME's key — writing that key would report a change nobody sees.
        Some("pantheon") => Box::new(Gsettings { color_scheme: None, ..Gsettings::gnome("pantheon", "Pantheon") }),
        Some("cinnamon") => Box::new(Gsettings::cinnamon()),
        Some("mate") => Box::new(Gsettings::mate()),
        Some("xfce") => Box::new(Xfce),
        Some("plasma") => match Plasma::detect() {
            Some(p) => Box::new(p),
            None => Box::new(Unknown("KDE Plasma (brak narzędzi kwriteconfig)".into())),
        },
        Some("lxqt") => Box::new(Unknown("LXQt".into())),
        Some("cosmic") => Box::new(Unknown("COSMIC".into())),
        Some(_) => Box::new(Unknown(env::var("XDG_CURRENT_DESKTOP").unwrap_or_else(|_| "nieznane środowisko".into()))),
        None => Box::new(Unknown("nie wykryto środowiska graficznego".into())),
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
    let (legacy, name) = if kind == "icons" { (".icons", "icons") } else { (".themes", "themes") };
    let mut dirs = vec![
        (h.join(legacy), true),
        (h.join(".local/share").join(name), true),
        (PathBuf::from("/usr/share").join(name), false),
    ];
    // The system's other data directories. On most distributions these
    // repeat /usr/share; on NixOS they are the only place themes are.
    if let Some(data_dirs) = env::var_os("XDG_DATA_DIRS") {
        dirs.extend(env::split_paths(&data_dirs).map(|d| (d.join(name), false)));
    }
    dirs
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Each desktop the profile can name gets the implementation written
    /// for it, and the ones without one say what they are.
    #[test]
    fn each_desktop_gets_its_own_settings() {
        let cases = [
            (Some("gnome"), "gnome", "GNOME"),
            (Some("budgie"), "budgie", "Budgie"),
            (Some("cinnamon"), "cinnamon", "Cinnamon"),
            (Some("mate"), "mate", "MATE"),
            (Some("xfce"), "xfce", "Xfce"),
            (Some("lxqt"), "unknown", "LXQt"),
            (None, "unknown", "nie wykryto środowiska graficznego"),
        ];
        for (profile, id, name) in cases {
            let desktop = desktop_for(profile);
            assert_eq!((desktop.id(), desktop.name().as_str()), (id, name), "{profile:?}");
        }
        assert!(Gsettings::cinnamon().gtk_theme.is_some_and(|(schema, _)| schema.starts_with("org.cinnamon")));
        assert!(Gsettings::mate().color_scheme.is_none());
    }
}
