//! autostart sidecar: lists and toggles user-scope XDG autostart entries
//! (~/.config/autostart/*.desktop) — no elevation, nothing system-wide.
//! Also supports adding/editing/deleting *custom* entries the user creates
//! from inside the app.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"scan"}
//!   {"cmd":"toggle","id":"<filename>","enabled":true|false}
//!   {"cmd":"check_path","path":"/abs/path"}
//!   {"cmd":"add","id":null,"name":"...","path":"...","args":null,"icon":null,"wrap_in_shell":false,"make_executable":false}
//!   {"cmd":"delete","id":"<filename>"}
//!
//! Safety: only ever writes files inside ~/.config/autostart; "toggling
//! off" sets the standard Hidden=true key (freedesktop.org desktop-entry
//! spec) plus the legacy X-GNOME-Autostart-enabled=false key GNOME-family
//! desktops check first — never deletes anything, so it's always reversible.
//! Entries created through `add` are tagged with X-POSMA-Custom=true; edit
//! (add with an existing id) and delete both re-verify that tag on disk
//! before touching a file, so a file an installed app dropped there can
//! never be edited or removed by this module — only ones this app made.

use std::env;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Scan,
    Toggle {
        id: String,
        enabled: bool,
    },
    CheckPath {
        path: String,
    },
    Add {
        #[serde(default)]
        id: Option<String>,
        name: String,
        path: String,
        #[serde(default)]
        args: Option<String>,
        #[serde(default)]
        icon: Option<String>,
        #[serde(default)]
        wrap_in_shell: bool,
        #[serde(default)]
        make_executable: bool,
    },
    Delete {
        id: String,
    },
}

#[derive(Serialize)]
struct Entry {
    id: String,
    name: String,
    exec: String,
    icon: Option<String>,
    comment: Option<String>,
    enabled: bool,
    custom: bool,
}

#[derive(Serialize)]
struct ScanResult {
    entries: Vec<Entry>,
}

#[derive(Serialize)]
struct ToggleResult {
    enabled: bool,
}

#[derive(Serialize)]
struct CheckPathResult {
    exists: bool,
    is_file: bool,
    executable: bool,
    has_shebang: bool,
}

#[derive(Serialize)]
struct AddResult {
    id: String,
}

#[derive(Serialize)]
struct DeleteResult {
    removed: bool,
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

fn autostart_dir() -> PathBuf {
    let home = env::var("HOME").unwrap_or_else(|_| "/root".into());
    PathBuf::from(home).join(".config/autostart")
}

/// Small tolerant parser for the handful of [Desktop Entry] keys this
/// module uses — ignores localized variants (Name[en_US]=...) and anything else.
fn parse_desktop_entry(text: &str) -> Option<(String, String, Option<String>, Option<String>, bool, bool)> {
    let mut name = None;
    let mut exec = None;
    let mut icon = None;
    let mut comment = None;
    let mut hidden = false;
    let mut gnome_disabled = false;
    let mut custom = false;
    let mut in_section = false;

    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_section = line == "[Desktop Entry]";
            continue;
        }
        if !in_section || line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        let (key, value) = (key.trim(), value.trim());
        match key {
            "Name" if name.is_none() => name = Some(value.to_string()),
            "Exec" => exec = Some(value.to_string()),
            "Icon" => icon = Some(value.to_string()),
            "Comment" if comment.is_none() => comment = Some(value.to_string()),
            "Hidden" => hidden = value.eq_ignore_ascii_case("true"),
            "X-GNOME-Autostart-enabled" => gnome_disabled = value.eq_ignore_ascii_case("false"),
            "X-POSMA-Custom" => custom = value.eq_ignore_ascii_case("true"),
            _ => {}
        }
    }

    let name = name?;
    let exec = exec?;
    // Either signal saying "disabled" wins — conservative, matches what a
    // user would expect "is this actually going to run at login" to mean.
    let enabled = !hidden && !gnome_disabled;
    Some((name, exec, icon, comment, enabled, custom))
}

fn scan() -> ScanResult {
    let dir = autostart_dir();
    let mut entries = Vec::new();

    let Ok(read) = fs::read_dir(&dir) else {
        return ScanResult { entries };
    };

    for entry in read.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("desktop") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let Some((name, exec, icon, comment, enabled, custom)) = parse_desktop_entry(&text) else { continue };
        let Some(id) = path.file_name().map(|f| f.to_string_lossy().into_owned()) else { continue };
        entries.push(Entry { id, name, exec, icon, comment, enabled, custom });
    }

    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    ScanResult { entries }
}

/// Re-derives "is this a POSMA-created entry" straight from disk — never
/// trusted from the request — so edit/delete can never touch a file some
/// installed app dropped into ~/.config/autostart on its own.
fn is_custom_entry(path: &Path) -> bool {
    fs::read_to_string(path)
        .map(|t| t.lines().any(|l| l.trim().eq_ignore_ascii_case("X-POSMA-Custom=true")))
        .unwrap_or(false)
}

fn slugify(name: &str) -> String {
    let mut slug = String::new();
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let trimmed = slug.trim_matches('-');
    if trimmed.is_empty() { "wpis".to_string() } else { trimmed.to_string() }
}

/// Quotes a single token for a desktop-entry Exec= line (spec-style double
/// quoting), escaping the handful of characters that are special inside it.
fn quote_exec_token(s: &str) -> String {
    let escaped = s.replace('\\', "\\\\").replace('"', "\\\"").replace('$', "\\$").replace('`', "\\`");
    format!("\"{escaped}\"")
}

fn check_path(path: String) -> CheckPathResult {
    let p = PathBuf::from(&path);
    let Ok(meta) = fs::metadata(&p) else {
        return CheckPathResult { exists: false, is_file: false, executable: false, has_shebang: false };
    };
    #[cfg(unix)]
    let executable = {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    };
    #[cfg(not(unix))]
    let executable = true;
    let has_shebang = fs::read(&p).map(|bytes| bytes.starts_with(b"#!")).unwrap_or(false);
    CheckPathResult { exists: true, is_file: meta.is_file(), executable, has_shebang }
}

#[allow(clippy::too_many_arguments)]
fn add(
    id: Option<String>,
    name: String,
    path: String,
    args: Option<String>,
    icon: Option<String>,
    wrap_in_shell: bool,
    make_executable: bool,
) -> Result<AddResult, String> {
    let dir = autostart_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let filename = match id {
        Some(existing_id) => {
            if existing_id.contains('/') || existing_id.contains("..") || !existing_id.ends_with(".desktop") {
                return Err("nieprawidłowy identyfikator wpisu".into());
            }
            if !is_custom_entry(&dir.join(&existing_id)) {
                return Err("można edytować tylko wpisy dodane ręcznie w tej aplikacji".into());
            }
            existing_id
        }
        None => {
            let base = slugify(&name);
            let mut candidate = format!("posma-custom-{base}.desktop");
            let mut n = 2;
            while dir.join(&candidate).exists() {
                candidate = format!("posma-custom-{base}-{n}.desktop");
                n += 1;
            }
            candidate
        }
    };

    if make_executable {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            // chmod only inside the user's own home — this module's whole
            // scope is user-level autostart, and quietly making arbitrary
            // paths elsewhere executable is beyond what "add my script to
            // autostart" should ever do.
            let canon = fs::canonicalize(&path).map_err(|e| format!("{path}: {e}"))?;
            let home = PathBuf::from(env::var("HOME").unwrap_or_else(|_| "/root".into()));
            let home_canon = home.canonicalize().map_err(|e| e.to_string())?;
            if !canon.starts_with(&home_canon) {
                return Err("nadanie uprawnień wykonywania możliwe tylko dla plików w katalogu domowym".into());
            }
            let meta = fs::metadata(&canon).map_err(|e| format!("{path}: {e}"))?;
            let mut perms = meta.permissions();
            perms.set_mode(perms.mode() | 0o111);
            fs::set_permissions(&canon, perms).map_err(|e| format!("nie udało się nadać uprawnień wykonywania: {e}"))?;
        }
    }

    let exec_target = if wrap_in_shell {
        format!("bash {}", quote_exec_token(&path))
    } else {
        quote_exec_token(&path)
    };
    let exec_line = match args.as_deref().map(str::trim) {
        Some(a) if !a.is_empty() => format!("{exec_target} {a}"),
        _ => exec_target,
    };

    let mut contents = String::from("[Desktop Entry]\n");
    contents.push_str("Type=Application\n");
    contents.push_str(&format!("Name={name}\n"));
    contents.push_str(&format!("Exec={exec_line}\n"));
    if let Some(icon) = icon.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        contents.push_str(&format!("Icon={icon}\n"));
    }
    contents.push_str("Hidden=false\n");
    contents.push_str("X-GNOME-Autostart-enabled=true\n");
    contents.push_str("X-POSMA-Custom=true\n");

    fs::write(dir.join(&filename), contents).map_err(|e| e.to_string())?;
    Ok(AddResult { id: filename })
}

fn delete(id: String) -> Result<DeleteResult, String> {
    if id.contains('/') || id.contains("..") || !id.ends_with(".desktop") {
        return Err("nieprawidłowy identyfikator wpisu".into());
    }
    let path = autostart_dir().join(&id);
    if !is_custom_entry(&path) {
        return Err("można usuwać tylko wpisy dodane ręcznie w tej aplikacji".into());
    }
    fs::remove_file(&path).map_err(|e| format!("{id}: {e}"))?;
    Ok(DeleteResult { removed: true })
}

/// Rewrites the Hidden / X-GNOME-Autostart-enabled keys in the target
/// file's [Desktop Entry] section in place; every other line (including
/// localized Name[xx]/Comment[xx] variants) passes through untouched.
fn toggle(id: String, enabled: bool) -> Result<ToggleResult, String> {
    if id.contains('/') || id.contains("..") || !id.ends_with(".desktop") {
        return Err("nieprawidłowy identyfikator wpisu".into());
    }
    let path = autostart_dir().join(&id);
    let text = fs::read_to_string(&path).map_err(|e| format!("{id}: {e}"))?;

    let mut out = Vec::new();
    let mut in_section = false;
    let mut wrote_hidden = false;
    let mut wrote_gnome = false;

    let flush_missing_keys = |out: &mut Vec<String>, wrote_hidden: bool, wrote_gnome: bool| {
        if !wrote_hidden {
            out.push(format!("Hidden={}", !enabled));
        }
        if !wrote_gnome {
            out.push(format!("X-GNOME-Autostart-enabled={enabled}"));
        }
    };

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            if in_section {
                flush_missing_keys(&mut out, wrote_hidden, wrote_gnome);
            }
            in_section = trimmed == "[Desktop Entry]";
            out.push(line.to_string());
            continue;
        }
        if in_section && trimmed.starts_with("Hidden=") {
            out.push(format!("Hidden={}", !enabled));
            wrote_hidden = true;
            continue;
        }
        if in_section && trimmed.starts_with("X-GNOME-Autostart-enabled=") {
            out.push(format!("X-GNOME-Autostart-enabled={enabled}"));
            wrote_gnome = true;
            continue;
        }
        out.push(line.to_string());
    }
    if in_section {
        flush_missing_keys(&mut out, wrote_hidden, wrote_gnome);
    }

    let new_text = out.join("\n") + "\n";
    fs::write(&path, new_text).map_err(|e| format!("{id}: {e}"))?;
    Ok(ToggleResult { enabled })
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
            Ok(Request::Toggle { id, enabled }) => match toggle(id, enabled) {
                Ok(data) => serde_json::to_string(&ok(data)),
                Err(error) => serde_json::to_string(&Response::<()>::Err { ok: false, error }),
            },
            Ok(Request::CheckPath { path }) => serde_json::to_string(&ok(check_path(path))),
            Ok(Request::Add { id, name, path, args, icon, wrap_in_shell, make_executable }) => {
                match add(id, name, path, args, icon, wrap_in_shell, make_executable) {
                    Ok(data) => serde_json::to_string(&ok(data)),
                    Err(error) => serde_json::to_string(&Response::<()>::Err { ok: false, error }),
                }
            }
            Ok(Request::Delete { id }) => match delete(id) {
                Ok(data) => serde_json::to_string(&ok(data)),
                Err(error) => serde_json::to_string(&Response::<()>::Err { ok: false, error }),
            },
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
