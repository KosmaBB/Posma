//! grub-editor sidecar: everything that doesn't need root.
//!
//!  - `scan`: reads /etc/default/grub (world-readable — 644 on a stock
//!    Debian/Ubuntu install) and parses the handful of keys this module's
//!    UI edits, while keeping the full raw text too so a save round-trips
//!    every comment and custom line this file has that the UI doesn't
//!    know about (this dev machine's real /etc/default/grub has
//!    hand-written comments and a custom GRUB_DEFAULT/GRUB_THEME — losing
//!    those on save would be a real regression, not just untidy).
//!  - presets (`list_presets`/`load_preset`/`save_preset`/`delete_preset`):
//!    named snapshots of a full config text, stored under
//!    ~/.local/share/posma/grub-presets/ — pure unprivileged file I/O,
//!    "zapisać wcześniejsze opcje i wgrać je jednym przyciskiem".
//!  - `inspect_theme`: given a directory the user picked (a downloaded,
//!    already-extracted GRUB theme), checks for theme.txt — that's the
//!    "auto rozpoznawanie co jest czym" for themes: no manual file-type
//!    picking, just point at the folder.
//!  - `list_backups`: reads both backup locations (created world-readable
//!    by the broker) so the restore list doesn't need its own privileged
//!    round-trip just to display.
//!
//! Actually writing /etc/default/grub, installing a theme into
//! /boot/grub/themes, reading /boot/grub/grub.cfg (600, root-only) for the
//! boot-entry list, and restoring a backup all need root — those go
//! through modules/linux-broker's write_grub_config/install_grub_theme/
//! read_boot_entries/restore_grub_backup, never through this binary.

use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Scan,
    ListPresets,
    LoadPreset { name: String },
    SavePreset { name: String, content: String },
    DeletePreset { name: String },
    InspectTheme { path: String },
    /// `theme_dir` may be either a theme folder or a path straight to its
    /// theme.txt (that's how the currently-active theme is stored in
    /// GRUB_THEME) — normalized to the folder either way.
    PreviewTheme { theme_dir: String },
}

#[derive(Serialize, Default)]
struct GrubFields {
    grub_default: String,
    grub_timeout: Option<i64>,
    grub_timeout_style: String,
    grub_theme: Option<String>,
    grub_disable_os_prober: bool,
}

#[derive(Serialize)]
struct BackupEntry {
    filename: String,
    created_unix: u64,
}

#[derive(Serialize)]
struct ScanResult {
    raw_content: String,
    fields: GrubFields,
    backups: Vec<BackupEntry>,
}

#[derive(Serialize)]
struct PresetInfo {
    name: String,
}

#[derive(Serialize)]
struct PresetContent {
    content: String,
}

#[derive(Serialize)]
struct ThemeInspection {
    valid: bool,
    name: String,
    files: u64,
    size_bytes: u64,
}

/// Raw values straight from theme.txt's `boot_menu { ... }` block (e.g.
/// `"55%"`), not parsed into numbers — CSS accepts percentage strings
/// natively, so passing them through as-is is both simpler and more
/// faithful than converting to a unit this code would have to guess at.
#[derive(Serialize, Default)]
struct BootMenuBox {
    left: Option<String>,
    top: Option<String>,
    width: Option<String>,
    height: Option<String>,
}

#[derive(Serialize)]
struct ThemePreview {
    valid: bool,
    /// A `data:image/...;base64,...` URI, not a filesystem path — sidesteps
    /// needing Tauri's asset-protocol scope configured for an arbitrary
    /// theme directory (the user's pre-install pick could be anywhere),
    /// and works identically for the already-installed case too.
    background_data_url: Option<String>,
    desktop_color: Option<String>,
    title_text: Option<String>,
    boot_menu: BootMenuBox,
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

fn err<T: Serialize>(error: String) -> Response<T> {
    Response::Err { ok: false, error }
}

fn unquote(s: &str) -> String {
    let s = s.trim();
    if s.len() >= 2 {
        let bytes = s.as_bytes();
        if (bytes[0] == b'"' && bytes[s.len() - 1] == b'"') || (bytes[0] == b'\'' && bytes[s.len() - 1] == b'\'') {
            return s[1..s.len() - 1].to_string();
        }
    }
    s.to_string()
}

fn parse_grub_fields(content: &str) -> GrubFields {
    let mut fields = GrubFields { grub_timeout_style: "menu".into(), ..Default::default() };
    for line in content.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("GRUB_DEFAULT=") {
            fields.grub_default = unquote(v);
        } else if let Some(v) = line.strip_prefix("GRUB_TIMEOUT_STYLE=") {
            fields.grub_timeout_style = unquote(v);
        } else if let Some(v) = line.strip_prefix("GRUB_TIMEOUT=") {
            fields.grub_timeout = unquote(v).parse().ok();
        } else if let Some(v) = line.strip_prefix("GRUB_THEME=") {
            let theme = unquote(v);
            if !theme.is_empty() {
                fields.grub_theme = Some(theme);
            }
        } else if let Some(v) = line.strip_prefix("GRUB_DISABLE_OS_PROBER=") {
            fields.grub_disable_os_prober = unquote(v) == "true";
        }
    }
    fields
}

/// Lists both the current shared broker layout
/// (/var/backups/posma/grub/backup.<ts>) and the legacy one this module
/// used before the broker was generalized and before the POSAM->POSMA
/// rename (/var/backups/posam-grub/grub.<ts>, old spelling on purpose —
/// that is the directory that exists on disk),
/// so backups taken before that refactor stay visible and restorable.
fn list_backups() -> Vec<BackupEntry> {
    let mut out = Vec::new();
    for (dir, prefix) in [("/var/backups/posma/grub", "backup."), ("/var/backups/posam-grub", "grub.")] {
        let Ok(read) = fs::read_dir(dir) else { continue };
        for entry in read.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(ts_str) = name.strip_prefix(prefix) else { continue };
            let Ok(created_unix) = ts_str.parse::<u64>() else { continue };
            out.push(BackupEntry { filename: name, created_unix });
        }
    }
    out.sort_by(|a, b| b.created_unix.cmp(&a.created_unix));
    out
}

fn scan() -> ScanResult {
    let raw_content = fs::read_to_string("/etc/default/grub").unwrap_or_default();
    let fields = parse_grub_fields(&raw_content);
    ScanResult { raw_content, fields, backups: list_backups() }
}

fn presets_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/root".into());
    PathBuf::from(home).join(".local/share/posma/grub-presets")
}

/// Same shape of rule as every other user-facing name in this codebase
/// (linux-broker's `is_safe_package_id`, uninstaller's leftover matching) —
/// no path separators or traversal, so it can only ever resolve to a file
/// directly inside presets_dir().
fn is_safe_preset_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 60 && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ' '))
}

fn preset_path(name: &str) -> Option<PathBuf> {
    if !is_safe_preset_name(name) {
        return None;
    }
    Some(presets_dir().join(format!("{name}.grubconf")))
}

fn list_presets() -> Vec<PresetInfo> {
    let mut out = Vec::new();
    let Ok(read) = fs::read_dir(presets_dir()) else { return out };
    for entry in read.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("grubconf") {
            continue;
        }
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            out.push(PresetInfo { name: stem.to_string() });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn measure(path: &Path) -> (u64, u64) {
    let mut size = 0u64;
    let mut files = 0u64;
    let Ok(read) = fs::read_dir(path) else { return (0, 0) };
    for entry in read.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            let (s, f) = measure(&entry.path());
            size += s;
            files += f;
        } else if meta.is_file() {
            size += meta.len();
            files += 1;
        }
    }
    (size, files)
}

fn inspect_theme(path: String) -> ThemeInspection {
    let dir = PathBuf::from(&path);
    if !dir.join("theme.txt").is_file() {
        return ThemeInspection { valid: false, name: String::new(), files: 0, size_bytes: 0 };
    }
    let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let (size_bytes, files) = measure(&dir);
    ThemeInspection { valid: true, name, files, size_bytes }
}

fn mime_for_ext(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    }
}

/// Only the first `boot_menu { ... }` block's `left`/`top`/`width`/`height`
/// — good enough for a rough preview, not a full theme.txt parser (themes
/// can nest many more component blocks this doesn't try to understand).
fn parse_boot_menu_box(content: &str) -> BootMenuBox {
    let mut result = BootMenuBox::default();
    let Some(start) = content.find("boot_menu") else { return result };
    let Some(brace_offset) = content[start..].find('{') else { return result };
    let body_start = start + brace_offset + 1;
    let Some(end_offset) = content[body_start..].find('}') else { return result };
    let body = &content[body_start..body_start + end_offset];

    for line in body.lines() {
        let line = line.trim();
        if let Some((key, value)) = line.split_once('=') {
            let value = value.trim().to_string();
            match key.trim() {
                "left" => result.left = Some(value),
                "top" => result.top = Some(value),
                "width" => result.width = Some(value),
                "height" => result.height = Some(value),
                _ => {}
            }
        }
    }
    result
}

fn theme_preview(theme_dir: String) -> ThemePreview {
    let raw = PathBuf::from(&theme_dir);
    let dir = if raw.file_name().and_then(|n| n.to_str()) == Some("theme.txt") {
        raw.parent().map(|p| p.to_path_buf()).unwrap_or(raw)
    } else {
        raw
    };

    let Ok(content) = fs::read_to_string(dir.join("theme.txt")) else {
        return ThemePreview { valid: false, background_data_url: None, desktop_color: None, title_text: None, boot_menu: BootMenuBox::default() };
    };

    let mut desktop_image = None;
    let mut desktop_color = None;
    let mut title_text = None;
    for line in content.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("desktop-image:") {
            desktop_image = Some(unquote(v));
        } else if let Some(v) = line.strip_prefix("desktop-color:") {
            desktop_color = Some(unquote(v));
        } else if let Some(v) = line.strip_prefix("title-text:") {
            let t = unquote(v);
            if !t.is_empty() {
                title_text = Some(t);
            }
        }
    }

    let background_data_url = desktop_image.and_then(|name| {
        let path = dir.join(&name);
        let bytes = fs::read(&path).ok()?;
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        Some(format!("data:{};base64,{}", mime_for_ext(ext), STANDARD.encode(&bytes)))
    });

    ThemePreview { valid: true, background_data_url, desktop_color, title_text, boot_menu: parse_boot_menu_box(&content) }
}

fn handle(req: Request) -> String {
    let out = match req {
        Request::Scan => serde_json::to_string(&ok(scan())),
        Request::ListPresets => serde_json::to_string(&ok(list_presets())),
        Request::LoadPreset { name } => match preset_path(&name).and_then(|p| fs::read_to_string(p).ok()) {
            Some(content) => serde_json::to_string(&ok(PresetContent { content })),
            None => serde_json::to_string(&err::<()>(format!("{name}: nie znaleziono presetu"))),
        },
        Request::SavePreset { name, content } => match preset_path(&name) {
            Some(path) => {
                let result = fs::create_dir_all(presets_dir()).and_then(|_| fs::write(&path, &content));
                match result {
                    Ok(()) => serde_json::to_string(&ok(())),
                    Err(e) => serde_json::to_string(&err::<()>(e.to_string())),
                }
            }
            None => serde_json::to_string(&err::<()>(format!("{name}: nieprawidłowa nazwa presetu"))),
        },
        Request::DeletePreset { name } => match preset_path(&name) {
            Some(path) => match fs::remove_file(path) {
                Ok(()) => serde_json::to_string(&ok(())),
                Err(e) => serde_json::to_string(&err::<()>(e.to_string())),
            },
            None => serde_json::to_string(&err::<()>(format!("{name}: nieprawidłowa nazwa presetu"))),
        },
        Request::InspectTheme { path } => serde_json::to_string(&ok(inspect_theme(path))),
        Request::PreviewTheme { theme_dir } => serde_json::to_string(&ok(theme_preview(theme_dir))),
    };
    out.expect("response must serialize")
}

fn main() {
    let mut line = String::new();
    let output = match io::stdin().lock().read_line(&mut line) {
        Ok(0) => serde_json::to_string(&err::<()>("no command received on stdin".into())).unwrap(),
        Ok(_) => match serde_json::from_str::<Request>(line.trim()) {
            Ok(req) => handle(req),
            Err(e) => serde_json::to_string(&err::<()>(format!("invalid request: {e}"))).unwrap(),
        },
        Err(e) => serde_json::to_string(&err::<()>(format!("failed to read stdin: {e}"))).unwrap(),
    };
    println!("{output}");
    io::stdout().flush().ok();
}
