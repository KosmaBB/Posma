//! autostart sidecar: lists and toggles user-scope XDG autostart entries
//! (~/.config/autostart/*.desktop) — no elevation, nothing system-wide.
//! Also supports adding/editing/deleting *custom* entries the user creates
//! from inside the app. On Windows: the account's Run key and Startup
//! folder, listed and toggled only (see `windows`).
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

/// Parsed [Desktop Entry] fields: name, exec, icon, comment, enabled, custom.
type ParsedEntry = (String, String, Option<String>, Option<String>, bool, bool);

/// Small tolerant parser for the handful of [Desktop Entry] keys this
/// module uses — ignores localized variants (Name[en_US]=...) and anything else.
fn parse_desktop_entry(text: &str) -> Option<ParsedEntry> {
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

/// Windows: the account's Run key and its Startup folder. Off is what Task
/// Manager writes — a value under StartupApproved, never the entry itself —
/// so it is always reversible. Programs add themselves there; adding one by
/// hand is the Linux module's, built around .desktop files.
mod windows {
    use super::{Entry, ScanResult, ToggleResult};
    use serde::Deserialize;
    use std::process::Command;

    /// UTF-8, because Windows PowerShell writes its OEM code page otherwise
    /// and a name in it would not come back to be switched. No double
    /// quotes, which it reads back unreliably from its command line. Off is
    /// an odd first byte under StartupApproved; no value there is on. Every
    /// list is wrapped in `@()` where it lands: PowerShell unrolls what a
    /// function returns, so one name would arrive as a string, none as null.
    const LIST_SCRIPT: &str = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; \
        $cv = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion'; \
        function Values($path) { $k = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue; \
          if ($k) { foreach ($n in $k.Property) { [pscustomobject]@{ name = $n; value = $k.GetValue($n) } } } }; \
        function Off($kind) { @(Values ($cv + '\\Explorer\\StartupApproved\\' + $kind) | \
          Where-Object { $_.value -is [byte[]] -and $_.value[0] % 2 } | ForEach-Object { $_.name }) }; \
        [pscustomobject]@{ \
          run = @(Values ($cv + '\\Run') | ForEach-Object { [pscustomobject]@{ name = $_.name; command = [string]$_.value } }); \
          folder = @(Get-ChildItem -LiteralPath ([Environment]::GetFolderPath('Startup')) -File -ErrorAction SilentlyContinue | \
            Where-Object { $_.Name -ne 'desktop.ini' } | ForEach-Object { [pscustomobject]@{ name = $_.Name; command = $_.FullName } }); \
          off_run = @(Off 'Run'); off_folder = @(Off 'StartupFolder') \
        } | ConvertTo-Json -Compress -Depth 4";

    const APPROVED: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved";

    #[derive(Deserialize, Default)]
    pub struct Listing {
        run: Vec<Item>,
        folder: Vec<Item>,
        off_run: Vec<String>,
        off_folder: Vec<String>,
    }

    #[derive(Deserialize)]
    struct Item {
        name: String,
        command: String,
    }

    fn listing() -> Result<Listing, String> {
        let out = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", LIST_SCRIPT])
            .output()
            .map_err(|e| format!("powershell.exe: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        let text = String::from_utf8_lossy(&out.stdout);
        serde_json::from_str(text.trim().trim_start_matches('\u{feff}')).map_err(|e| format!("nie udało się odczytać autostartu: {e}"))
    }

    pub fn entries(listing: Listing) -> Vec<Entry> {
        let off = |names: &[String], name: &str| names.iter().any(|n| n.eq_ignore_ascii_case(name));
        let run = listing.run.into_iter().map(|i| Entry {
            id: format!("run:{}", i.name),
            enabled: !off(&listing.off_run, &i.name),
            name: i.name,
            exec: i.command,
            icon: None,
            comment: Some("Rejestr: Run".into()),
            custom: false,
        });
        let folder = listing.folder.into_iter().map(|i| Entry {
            id: format!("folder:{}", i.name),
            enabled: !off(&listing.off_folder, &i.name),
            name: i.name.rsplit_once('.').map_or(i.name.as_str(), |(stem, _)| stem).to_string(),
            exec: i.command,
            icon: None,
            comment: Some("Folder Autostart".into()),
            custom: false,
        });
        let mut entries: Vec<Entry> = run.chain(folder).collect();
        entries.sort_by_key(|e| e.name.to_lowercase());
        entries
    }

    pub fn scan() -> ScanResult {
        ScanResult { entries: listing().map(entries).unwrap_or_default() }
    }

    /// Only an entry listed right now: the name goes to reg.exe as an
    /// argument of its own, and it must be one that is there.
    pub fn toggle(id: String, enabled: bool) -> Result<ToggleResult, String> {
        let (kind, name) = match id.split_once(':') {
            Some(("run", name)) => ("Run", name),
            Some(("folder", name)) => ("StartupFolder", name),
            _ => return Err("nieprawidłowy identyfikator wpisu".into()),
        };
        let current = listing()?;
        let items = if kind == "Run" { &current.run } else { &current.folder };
        if !items.iter().any(|i| i.name == name) {
            return Err(format!("{name}: nie ma takiego wpisu autostartu"));
        }
        let data = format!("{}0000000000000000000000", if enabled { "02" } else { "03" });
        let key = format!("{APPROVED}\\{kind}");
        let out = Command::new("reg")
            .args(["add", &key, "/v", name, "/t", "REG_BINARY", "/d", &data, "/f"])
            .output()
            .map_err(|e| format!("reg.exe: {e}"))?;
        if out.status.success() {
            Ok(ToggleResult { enabled })
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    }
}

fn scan() -> ScanResult {
    if cfg!(windows) {
        return windows::scan();
    }
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

    entries.sort_by_key(|a| a.name.to_lowercase());
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
    if cfg!(windows) {
        return Err("Na Windowsie programy same dopisują się do autostartu — POSMA tylko je włącza i wyłącza".into());
    }
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
    if cfg!(windows) {
        return windows::toggle(id, enabled);
    }
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

#[cfg(test)]
mod tests {
    use super::windows::{entries, Listing};

    /// Both Windows sources become entries, each on unless StartupApproved
    /// says off, with an id that names where it came from.
    #[test]
    fn windows_entries_carry_their_source_and_state() {
        let listing: Listing = serde_json::from_str(
            r#"{"run":[{"name":"OneDrive","command":"\"C:\\OneDrive.exe\" /background"}],
                "folder":[{"name":"Notatki.lnk","command":"C:\\Startup\\Notatki.lnk"}],
                "off_run":["onedrive"],"off_folder":[]}"#,
        )
        .unwrap();
        let read = entries(listing);
        assert_eq!(read.iter().map(|e| (e.id.as_str(), e.name.as_str(), e.enabled)).collect::<Vec<_>>(), [
            ("folder:Notatki.lnk", "Notatki", true),
            ("run:OneDrive", "OneDrive", false)
        ]);
    }
}
