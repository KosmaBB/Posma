//! Privileged Linux broker (Access_plan.md §4 / §6 step 3).
//!
//! All protocol, dispatch, validation, backup/rollback and transport logic
//! lives in the shared `broker-common` crate — this binary is only the
//! Linux-specific part: which catalogued operations it can honour, and how.
//! Operations it doesn't implement are answered honestly by the trait's
//! defaults rather than failing at the protocol level.
//!
//! Runs as root (via `pkexec`, or as the installed systemd service), so it
//! re-validates every request itself rather than trusting whatever core
//! already checked — the same defense-in-depth rule the unprivileged
//! sidecars apply to their own whitelists.

use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use broker_common::guards::{self, is_safe_name, is_safe_package_id};
use broker_common::ops::{PkgSource, TrimMode};
use broker_common::result::{BootEntries, BootOptions, CleanResult, ExecResult};
use broker_common::{run_capture, run_verify, Broker};
use distro::{Cmd, Manager};

const DEFAULT_SOCKET_PATH: &str = "/run/posma-broker.sock";
const DEFAULT_OWNER_UID_FILE: &str = "/etc/posma/broker-owner-uid";
const GRUB_DEFAULT_PATH: &str = distro::GRUB_DEFAULTS;
/// Where this module wrote backups before the broker was generalized AND
/// before the POSAM->POSMA rename. Spelled with the old name deliberately:
/// this is the directory that physically exists on machines that ran those
/// builds. Read-only, so pre-rename backups stay restorable.
const LEGACY_GRUB_BACKUP_DIR: &str = "/var/backups/posam-grub";

struct LinuxBroker;

/// System files this broker is willing to manage. Anything else is refused
/// — a caller cannot point `write_system_file` at an arbitrary root-owned
/// path.
fn is_managed_system_file(path: &Path) -> bool {
    path == Path::new(GRUB_DEFAULT_PATH)
}

/// What the GRUB editor sets. grub-mkconfig runs /etc/default/grub as a
/// shell script, as root, so without this list `write_system_file` would
/// be a way to run any command — and in daemon mode, without a password.
const GRUB_EDITABLE_KEYS: &[&str] = &[
    "GRUB_DEFAULT",
    "GRUB_TIMEOUT",
    "GRUB_TIMEOUT_STYLE",
    "GRUB_DISABLE_OS_PROBER",
    "GRUB_THEME",
    "GRUB_TERMINAL_OUTPUT",
];

/// A value the shell reads as plain text: safe characters unquoted, or one
/// quoted string with nothing after it. `$` and backticks are refused even
/// inside double quotes, where the shell still expands them.
fn is_inert_value(value: &str) -> bool {
    let value = value.trim_end();
    if value.contains(['$', '`']) {
        return false;
    }
    match value.chars().next() {
        Some('\'') => value.len() >= 2 && value.ends_with('\'') && !value[1..value.len() - 1].contains('\''),
        Some('"') => {
            let mut chars = value[1..].chars();
            while let Some(c) = chars.next() {
                match c {
                    // Escapes a quote or itself — the two the editor writes.
                    '\\' if !matches!(chars.next(), Some('"' | '\\')) => return false,
                    '"' => return chars.as_str().is_empty(),
                    _ => {}
                }
            }
            false
        }
        _ => value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | ',' | ':' | '/' | '+' | '@' | '%' | '=' | '-')),
    }
}

/// Refuses a new /etc/default/grub that would make grub-mkconfig run
/// anything. A line already in the current file passes as it is: the
/// distribution's own GRUB_DISTRIBUTOR is often a command substitution, and
/// it is root's to keep. Every other line must be blank, a comment, or an
/// assignment of a key the editor sets, to plain text.
fn check_grub_defaults(current: &str, proposed: &str) -> Result<(), String> {
    let existing: HashSet<&str> = current.lines().collect();
    for line in proposed.lines().filter(|l| !existing.contains(l)) {
        let trimmed = line.trim();
        let allowed = if trimmed.is_empty() {
            true
        } else if trimmed.starts_with('#') {
            !trimmed.contains(['$', '`'])
        } else {
            trimmed.split_once('=').is_some_and(|(key, value)| GRUB_EDITABLE_KEYS.contains(&key) && is_inert_value(value))
        };
        if !allowed {
            return Err(format!(
                "odmowa: linia „{trimmed}” — POSMA zmienia w {GRUB_DEFAULT_PATH} tylko ustawienia, które sama edytuje ({}), \
                 i tylko na zwykły tekst. Inne zmiany wprowadź ręcznie.",
                GRUB_EDITABLE_KEYS.join(", ")
            ));
        }
    }
    Ok(())
}

/// The quoted title at the start of `rest`, as GRUB writes it in grub.cfg.
fn quoted_title(rest: &str) -> Option<&str> {
    let quote = rest.chars().next().filter(|q| matches!(q, '\'' | '"'))?;
    let rest = &rest[1..];
    rest.find(quote).map(|end| &rest[..end])
}

/// Entry titles the way GRUB_DEFAULT names them: one inside a submenu is
/// "Submenu>Entry". Given just "Entry", GRUB looks for it at the top
/// level, finds nothing and quietly boots the first entry instead — and on
/// Debian, Ubuntu and openSUSE every older kernel sits in a submenu.
fn menu_entries(cfg: &str) -> Vec<String> {
    // One element per open `{` block: the title for a submenu, None for
    // anything else (a menuentry body, a function).
    let mut open: Vec<Option<&str>> = Vec::new();
    let mut entries = Vec::new();
    for line in cfg.lines().map(str::trim) {
        if line == "}" {
            open.pop();
            continue;
        }
        if let Some(title) = line.strip_prefix("menuentry ").and_then(quoted_title) {
            let path: Vec<&str> = open.iter().flatten().copied().chain([title]).collect();
            entries.push(path.join(">"));
        }
        if line.ends_with('{') {
            open.push(line.strip_prefix("submenu ").and_then(quoted_title));
        }
    }
    entries
}

/// Fedora's family keeps kernels out of grub.cfg: a `blscfg` line there
/// reads one file per kernel from /boot/loader/entries at boot, so the
/// menu's real entries are those files' titles. Newest first, as GRUB
/// lists them.
fn bls_titles(cfg: &str, dir: &Path) -> Vec<String> {
    if !cfg.lines().any(|l| l.trim() == "blscfg") {
        return Vec::new();
    }
    let Ok(read) = fs::read_dir(dir) else { return Vec::new() };
    let mut files: Vec<PathBuf> =
        read.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "conf")).collect();
    files.sort_by(|a, b| distro::version_cmp(&b.to_string_lossy(), &a.to_string_lossy()));
    files
        .iter()
        .filter_map(|p| {
            let text = fs::read_to_string(p).ok()?;
            let title = text.lines().find_map(|l| l.trim().strip_prefix("title")?.strip_prefix(char::is_whitespace))?;
            Some(title.trim().to_string()).filter(|t| !t.is_empty())
        })
        .collect()
}

/// How Limine, systemd-boot and rEFInd spell the two settings their editor
/// changes. Nothing runs these files, so what matters is which lines change:
/// a kernel command line is a root shell at the next boot, so no other may.
struct LoaderKeys {
    default: &'static str,
    timeout: &'static str,
    /// Limine writes `key: value`, the others `key value`.
    colon: bool,
    /// Timeouts that are words rather than seconds.
    timeout_words: &'static [&'static str],
    /// rEFInd reads a value with a space in it as several values.
    quote_spaces: bool,
}

fn loader_keys(loader: &str) -> Option<LoaderKeys> {
    let keys = |default, colon, timeout_words, quote_spaces| LoaderKeys { default, timeout: "timeout", colon, timeout_words, quote_spaces };
    match loader {
        "limine" => Some(keys("default_entry", true, &["no"], false)),
        "systemd-boot" => Some(keys("default", false, &["menu-force", "menu-hidden", "menu-disabled"], false)),
        "refind" => Some(keys("default_selection", false, &["-1"], true)),
        _ => None,
    }
}

/// The loader this machine boots through, where it is one edited in place,
/// with its spelling and its config file — found here, as root.
fn edited_loader() -> Result<(&'static str, LoaderKeys, PathBuf), String> {
    let loader = distro::bootloader().unwrap_or("other");
    let label = distro::bootloader_label(loader);
    let keys = loader_keys(loader).ok_or_else(|| format!("ten system uruchamia się przez {label}, nie przez Limine, systemd-boot ani rEFInd"))?;
    let path = distro::loader_config(loader).ok_or_else(|| format!("nie znaleziono pliku konfiguracji {label}"))?;
    Ok((loader, keys, path))
}

/// The value `line` gives `key`, where it sets it. Limine's option names
/// ignore case; the others' are lowercase anyway.
fn option_value<'a>(line: &'a str, key: &str, colon: bool) -> Option<&'a str> {
    let line = line.trim_start();
    let rest = line.get(key.len()..).filter(|_| line[..key.len()].eq_ignore_ascii_case(key))?;
    let value = if colon { rest.strip_prefix(':')? } else { rest.strip_prefix(char::is_whitespace)? };
    Some(value.trim())
}

/// `content` with `key` set to `value` on every line that sets it, or on a
/// new first line where none does. Every other line stays byte for byte.
fn set_option(content: &str, key: &str, colon: bool, value: &str) -> String {
    let new = if colon { format!("{key}: {value}") } else { format!("{key} {value}") };
    let sets = |l: &str| option_value(l, key, colon).is_some();
    if !content.split('\n').any(sets) {
        return format!("{new}\n{content}");
    }
    content.split('\n').map(|l| if sets(l) { new.as_str() } else { l }).collect::<Vec<_>>().join("\n")
}

/// Limine's entries by the path `default_entry` takes: one `/` per level, a
/// `+` opening a directory by default, and `/`, `\` and `#` escaped in
/// names. Directories are left out — naming one stops autoboot.
// shortcut: siblings sharing a name need a `#N` suffix, not added; add it if
// limine-entry-tool's duplicate kernels turn up.
fn limine_entries(content: &str) -> Vec<String> {
    let items: Vec<(usize, String)> = content
        .lines()
        .map(str::trim)
        .filter_map(|l| {
            let depth = l.len() - l.trim_start_matches('/').len();
            let name = l[depth..].trim_start_matches('+').trim();
            (depth > 0).then(|| (depth, name.replace('\\', "\\\\").replace('/', "\\/").replace('#', "\\#")))
        })
        .collect();
    let mut path: Vec<&str> = Vec::new();
    let mut entries = Vec::new();
    for (i, (depth, name)) in items.iter().enumerate() {
        path.truncate(depth - 1);
        path.push(name);
        if items.get(i + 1).is_none_or(|next| next.0 <= *depth) {
            entries.push(path.join("/"));
        }
    }
    entries
}

/// What the loader's default setting can name. systemd-boot's own list
/// covers entries it finds without a file; rEFInd finds most of its own at
/// boot, so only the stanzas written in refind.conf can be listed.
fn loader_entries(loader: &str, content: &str) -> Vec<String> {
    match loader {
        "limine" => limine_entries(content),
        "systemd-boot" => {
            let listed = run_capture("bootctl", &["list".into(), "--json=short".into()]);
            serde_json::from_str::<Vec<serde_json::Value>>(&listed.output)
                .unwrap_or_default()
                .iter()
                .filter_map(|e| e["id"].as_str().map(String::from))
                .collect()
        }
        _ => content
            .lines()
            .filter_map(|l| l.trim().strip_prefix("menuentry").map(str::trim_start).and_then(quoted_title))
            .map(String::from)
            .collect(),
    }
}

/// limine-entry-tool can seal limine.conf with a checksum kept inside Limine,
/// and a changed file then does not boot until its tool seals it again —
/// which the tool does only where sealing is on. Nothing else needs a step.
fn verify_loader(loader: &str) -> Result<String, String> {
    match distro::find_program("limine-enroll-config") {
        Some(tool) if loader == "limine" => run_verify(&tool.to_string_lossy(), &[]),
        _ => Ok(String::new()),
    }
}

/// Flat log files sitting directly inside /var/log — mirrors temp-clean's
/// own `is_allowed_var_log_file` rule, re-checked here independently since
/// this process runs as root. Directories (journal/, apt/, ...) are never
/// eligible: the journal has its own dedicated trim operation.
fn is_allowed_var_log_file(path: &Path) -> bool {
    let Some(parent) = path.parent().and_then(|p| p.canonicalize().ok()) else {
        return false;
    };
    parent == Path::new("/var/log") && path.is_file() && !path.is_symlink()
}

/// Rebuilds the boot menu with whichever tool this distribution ships —
/// `update-grub`, `grub-mkconfig` or `grub2-mkconfig`.
fn update_grub() -> Result<String, String> {
    let grub = distro::grub()?;
    run_verify(&grub.regenerate[0], &grub.regenerate[1..])
}

/// Runs a command the shared `distro` crate composed. Separate from
/// `run_capture` only because one of them needs its answers on stdin.
fn run_cmd(cmd: Cmd) -> ExecResult {
    if cmd.stdin.is_empty() {
        return run_capture(&cmd.argv[0], &cmd.argv[1..]);
    }
    let spawned = Command::new(&cmd.argv[0])
        .args(&cmd.argv[1..])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => return ExecResult::failed(e.to_string()),
    };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(cmd.stdin.as_bytes());
    }
    match child.wait_with_output() {
        Ok(out) if out.status.success() => ExecResult::ok(String::from_utf8_lossy(&out.stdout).into_owned()),
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            ExecResult::failed(if stderr.is_empty() { "polecenie zakończyło się błędem".into() } else { stderr })
        }
        Err(e) => ExecResult::failed(e.to_string()),
    }
}

/// The system's own package manager, provided `source` is the one naming
/// it. Anything else is refused: which tool runs as root is decided by
/// what this machine is, not by what the request says. `source` counts only
/// where os-release declares no family — then it picks among the managers
/// actually installed, as the user's answer did for the modules.
fn native(source: PkgSource) -> Result<Manager, String> {
    let wanted = match source {
        PkgSource::Apt => Manager::Apt,
        PkgSource::Pacman => Manager::Pacman,
        PkgSource::Dnf => Manager::Dnf,
        PkgSource::Zypper => Manager::Zypper,
        other => return Err(format!("{other:?}: nieobsługiwane źródło pakietu na Linuksie")),
    };
    match distro::manager_preferring(Some(wanted))? {
        actual if actual == wanted => Ok(actual),
        actual => Err(format!("odmowa: ten system używa {}, nie {}", actual.id(), wanted.id())),
    }
}

impl Broker for LinuxBroker {
    fn os_name(&self) -> &'static str {
        "linux"
    }

    fn implemented_ops(&self) -> Vec<&'static str> {
        vec![
            "clean_system_paths",
            "write_system_file",
            "restore_system_file_backup",
            "install_directory",
            "pkg_remove",
            "pkg_remove_revision",
            "pkg_cache_clean",
            "pkg_autoremove",
            "remove_kernel",
            "trim_system_logs",
            "read_boot_entries",
            "set_boot_options",
            "smart_read",
        ]
    }

    fn clean_system_paths(&self, paths: Vec<String>) -> CleanResult {
        let mut result = CleanResult::default();
        for raw in paths {
            let path = PathBuf::from(&raw);
            if !is_allowed_var_log_file(&path) {
                result.errors.push(format!("{raw}: poza dozwolonymi lokalizacjami — pominięto"));
                continue;
            }
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            match fs::remove_file(&path) {
                Ok(()) => {
                    result.freed_bytes += size;
                    result.removed += 1;
                }
                Err(e) => result.errors.push(format!("{raw}: {e}")),
            }
        }
        result
    }

    fn write_system_file(&self, path: String, content: String, keep_backups: u64) -> ExecResult {
        let p = PathBuf::from(&path);
        if !is_managed_system_file(&p) {
            return ExecResult::failed(format!("{path}: plik spoza listy zarządzanych"));
        }
        // A restore skips this on purpose: a backup is a copy root took of
        // the file as it was, not text from the request.
        let current = fs::read_to_string(&p).unwrap_or_default();
        if let Err(why) = check_grub_defaults(&current, &content) {
            return ExecResult::failed(why);
        }
        broker_common::write_system_file_guarded(&p, content, keep_backups, update_grub)
    }

    fn restore_system_file_backup(&self, path: String, filename: String, keep_backups: u64) -> ExecResult {
        let p = PathBuf::from(&path);
        // The config of the loader edited in place is restored too — never
        // from GRUB's legacy directory, whose files are another file's.
        let loader = edited_loader().ok().filter(|(_, _, config)| *config == p).map(|(loader, _, _)| loader);
        if !is_managed_system_file(&p) && loader.is_none() {
            return ExecResult::failed(format!("{path}: plik spoza listy zarządzanych"));
        }
        // Accepts both the shared `backup.<ts>` layout and the legacy
        // `grub.<ts>` files this module wrote before the broker was
        // generalized — a user's existing safety net must not be orphaned
        // by an internal refactor.
        if !is_safe_name(&filename) || !(filename.starts_with("backup.") || filename.starts_with("grub.")) {
            return ExecResult::failed("nieprawidłowa nazwa kopii zapasowej");
        }
        let mut candidates = vec![guards::backup_dir_for(&p).join(&filename)];
        if loader.is_none() {
            candidates.push(PathBuf::from(LEGACY_GRUB_BACKUP_DIR).join(&filename));
        }
        let Some(content) = candidates.iter().find_map(|c| fs::read_to_string(c).ok()) else {
            return ExecResult::failed("nie znaleziono takiej kopii zapasowej");
        };
        match loader {
            Some(loader) => broker_common::write_system_file_guarded(&p, content, keep_backups, || verify_loader(loader)),
            None => broker_common::write_system_file_guarded(&p, content, keep_backups, update_grub),
        }
    }

    fn install_directory(
        &self,
        source_dir: String,
        dest_name: String,
        activate_content: Option<String>,
        activate_path: Option<String>,
        keep_backups: u64,
    ) -> ExecResult {
        if !is_safe_name(&dest_name) {
            return ExecResult::failed(format!("{dest_name}: nieprawidłowa nazwa"));
        }
        let source = PathBuf::from(&source_dir);
        // A GRUB theme is identified by theme.txt — refuse anything else so
        // this can't be used as a generic "copy a tree into /boot" tool.
        if !source.join("theme.txt").is_file() {
            return ExecResult::failed("brak theme.txt w podanym folderze — pominięto");
        }
        let themes_dir = match distro::grub() {
            Ok(grub) => grub.themes_dir,
            Err(why) => return ExecResult::failed(why),
        };
        let dest = themes_dir.join(&dest_name);
        // Shared guard — see broker_common::guards, written after a
        // self-copy zeroed a user's real theme.
        if guards::is_same_file(&source, &dest) {
            return ExecResult::failed("źródło i cel to ten sam folder — pominięto, nic nie zostało zmienione");
        }
        if let Err(e) = guards::copy_dir_recursive(&source, &dest) {
            return ExecResult::failed(format!("nie udało się skopiować: {e}"));
        }

        match (activate_content, activate_path) {
            (Some(content), Some(path)) => self.write_system_file(path, content, keep_backups),
            _ => ExecResult::ok(String::new()),
        }
    }

    fn pkg_remove(&self, source: PkgSource, id: String) -> ExecResult {
        if !is_safe_package_id(&id) {
            return ExecResult::failed(format!("{id}: nieprawidłowa nazwa pakietu — pominięto"));
        }
        match source {
            PkgSource::Snap => run_capture("snap", &["remove".into(), id]),
            other => match native(other) {
                // The uninstaller leaves these off its list; this is the
                // check that holds whatever the request says. A kernel in
                // particular would skip every lock `remove_kernel` keeps.
                Ok(manager) => {
                    let kernels: HashSet<String> = distro::kernels(manager).into_iter().map(|k| k.package).collect();
                    if distro::is_core_package(&id, &kernels) {
                        return ExecResult::failed(format!(
                            "odmowa: {id} należy do podstaw systemu — bez niego system może się nie uruchomić. \
                             Stare jądra usuwa moduł wersji jądra."
                        ));
                    }
                    run_cmd(manager.remove(&id))
                }
                Err(why) => ExecResult::failed(why),
            },
        }
    }

    fn pkg_remove_revision(&self, source: PkgSource, id: String, revision: u64) -> ExecResult {
        if !is_safe_package_id(&id) {
            return ExecResult::failed(format!("{id}: nieprawidłowa nazwa pakietu — pominięto"));
        }
        match source {
            PkgSource::Snap => run_capture("snap", &["remove".into(), id, format!("--revision={revision}")]),
            other => ExecResult::failed(format!("{other:?}: rewizje obsługuje tylko snap")),
        }
    }

    fn pkg_cache_clean(&self, source: PkgSource) -> ExecResult {
        match native(source) {
            Ok(manager) => run_cmd(manager.clean_cache()),
            Err(why) => ExecResult::failed(why),
        }
    }

    fn pkg_autoremove(&self, source: PkgSource) -> ExecResult {
        match native(source).map(|manager| manager.autoremove()) {
            Ok(Some(cmd)) => run_cmd(cmd),
            Ok(None) => ExecResult::ok("brak osieroconych pakietów".into()),
            Err(why) => ExecResult::failed(why),
        }
    }

    /// The highest-stakes operation in this catalog (Access_plan.md marks
    /// kernel-mgr "critical"): removing the wrong kernel can leave a
    /// machine unbootable. Re-derives the running and newest kernel HERE,
    /// inside the root process, and fails closed if either can't be
    /// determined — never trusting the sidecar or frontend, and never
    /// treating "couldn't tell" as "safe".
    fn remove_kernel(&self, package: String) -> ExecResult {
        if !is_safe_package_id(&package) {
            return ExecResult::failed(format!("{package}: nieprawidłowa nazwa pakietu jądra"));
        }
        let manager = match distro::manager() {
            Ok(m) => m,
            Err(why) => return ExecResult::failed(why),
        };
        if let Err(why) = manager.kernel_removal() {
            return ExecResult::failed(why);
        }
        let Some(running) = distro::running_kernel() else {
            return ExecResult::failed("odmowa: nie udało się ustalić aktywnego jądra");
        };

        // The list comes from the system, read here as root. A name the
        // request made up is simply not in it.
        let installed = distro::kernels(manager);
        let Some(target) = installed.iter().find(|k| k.package == package) else {
            return ExecResult::failed(format!("{package}: to nie jest zainstalowane jądro"));
        };
        if target.version == running {
            return ExecResult::failed("odmowa: to jest aktywne jądro");
        }
        if target.is_latest {
            return ExecResult::failed("odmowa: to jest najnowsze zainstalowane jądro");
        }

        run_cmd(manager.remove(&package))
    }

    fn trim_system_logs(&self, mode: TrimMode, value: u64) -> ExecResult {
        if value == 0 || value > 100_000 {
            return ExecResult::failed(format!("{value}: nieprawidłowa wartość"));
        }
        let arg = match mode {
            TrimMode::Size => format!("--vacuum-size={value}M"),
            TrimMode::Time => format!("--vacuum-time={value}d"),
        };
        run_capture("journalctl", &[arg])
    }

    fn read_boot_entries(&self) -> Result<BootEntries, String> {
        if distro::bootloader().is_some_and(|l| loader_keys(l).is_some()) {
            let (loader, keys, path) = edited_loader()?;
            let content = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
            let value = |key| content.lines().find_map(|l| option_value(l, key, keys.colon)).map(String::from);
            let options = BootOptions {
                loader,
                path: path.display().to_string(),
                default_entry: value(keys.default),
                timeout: value(keys.timeout),
            };
            return Ok(BootEntries { entries: loader_entries(loader, &content), options: Some(options) });
        }
        let entries = distro::grub()
            .ok()
            .and_then(|grub| fs::read_to_string(grub.cfg).ok())
            .map(|cfg| {
                let mut entries = bls_titles(&cfg, Path::new("/boot/loader/entries"));
                entries.extend(menu_entries(&cfg));
                entries
            })
            .unwrap_or_default();
        Ok(BootEntries { entries, options: None })
    }

    fn set_boot_options(&self, default_entry: Option<String>, timeout: Option<String>, keep_backups: u64) -> ExecResult {
        let (loader, keys, path) = match edited_loader() {
            Ok(found) => found,
            Err(why) => return ExecResult::failed(why),
        };
        let mut content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => return ExecResult::failed(format!("{}: {e}", path.display())),
        };
        if let Some(t) = timeout.as_deref() {
            // Limine reads anything else as 0: boot at once, no menu.
            let seconds = !t.is_empty() && t.len() <= 4 && t.bytes().all(|b| b.is_ascii_digit());
            if !seconds && !keys.timeout_words.contains(&t) {
                let words = keys.timeout_words.iter().map(|w| format!(" albo {w}")).collect::<String>();
                return ExecResult::failed(format!("„{t}”: czas oczekiwania to liczba sekund{words}"));
            }
            content = set_option(&content, keys.timeout, keys.colon, t);
        }
        if let Some(d) = default_entry.as_deref() {
            if d.is_empty() || d.len() > 255 || d.chars().any(char::is_control) {
                return ExecResult::failed("nieprawidłowa nazwa domyślnego wpisu");
            }
            let d = if keys.quote_spaces && d.contains(char::is_whitespace) && !d.starts_with('"') { format!("\"{d}\"") } else { d.to_string() };
            content = set_option(&content, keys.default, keys.colon, &d);
        }
        broker_common::write_system_file_guarded(&path, content, keep_backups, || verify_loader(loader))
    }

    /// Raw ATA/NVMe passthrough needs root, which is the whole reason this
    /// is a broker operation — the unprivileged health-monitor module can
    /// only report a permission error.
    fn smart_read(&self, device: String) -> ExecResult {
        let valid = device.starts_with("/dev/")
            && device["/dev/".len()..].chars().all(|c| c.is_ascii_alphanumeric() || c == '/');
        if !valid {
            return ExecResult::failed(format!("{device}: nieprawidłowa nazwa urządzenia"));
        }
        run_capture("smartctl", &["-a".into(), "-j".into(), device])
    }
}

fn main() {
    let broker = LinuxBroker;
    if std::env::args().nth(1).as_deref() == Some("--daemon") {
        let socket = std::env::var("POSMA_BROKER_SOCKET").unwrap_or_else(|_| DEFAULT_SOCKET_PATH.into());
        let uid_file = std::env::var("POSMA_BROKER_OWNER_UID_FILE").unwrap_or_else(|_| DEFAULT_OWNER_UID_FILE.into());
        broker_common::run_daemon(&broker, &socket, &uid_file);
    } else {
        broker_common::run_once(&broker);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ubuntu 24.04's stock file, shortened. Its GRUB_DISTRIBUTOR runs a
    /// command — as Debian's and Fedora's do.
    const UBUNTU: &str = "GRUB_DEFAULT=0\nGRUB_TIMEOUT_STYLE=hidden\nGRUB_TIMEOUT=0\n\
        GRUB_DISTRIBUTOR=`( . /etc/os-release; echo ${NAME:-Ubuntu} ) 2>/dev/null || echo Ubuntu`\n\
        GRUB_CMDLINE_LINUX_DEFAULT=\"quiet splash\"\nGRUB_CMDLINE_LINUX=\"\"\n#GRUB_TERMINAL=console\n";

    #[test]
    fn the_editor_s_own_changes_pass() {
        let edited = UBUNTU
            .replace("GRUB_DEFAULT=0", "GRUB_DEFAULT=\"Advanced options for Ubuntu>Ubuntu, with Linux 6.8.0-40-generic\"")
            .replace("GRUB_TIMEOUT=0", "GRUB_TIMEOUT=5")
            + "GRUB_DISABLE_OS_PROBER=false\nGRUB_THEME=\"/boot/grub/themes/My Theme/theme.txt\"\n\n# a note\n";
        assert_eq!(check_grub_defaults(UBUNTU, &edited), Ok(()));
        // A title with a quote in it, escaped the way the editor escapes it.
        assert_eq!(check_grub_defaults(UBUNTU, "GRUB_DEFAULT=\"Say \\\"hi\\\"\"\n"), Ok(()));
        // Fedora's line, unchanged, alongside a theme switched on.
        let fedora = "GRUB_DISTRIBUTOR=\"$(sed 's, release .*$,,g' /etc/system-release)\"\nGRUB_TERMINAL_OUTPUT=\"console\"\n";
        let themed = fedora.replace("\"console\"", "\"gfxterm\"");
        assert_eq!(check_grub_defaults(fedora, &themed), Ok(()));
    }

    #[test]
    fn anything_the_shell_would_run_is_refused() {
        for line in [
            "GRUB_TIMEOUT=5; touch /root/x",
            "GRUB_DEFAULT=\"$(id)\"",
            "GRUB_DEFAULT=`id`",
            "GRUB_DEFAULT=\"a\"b",
            "GRUB_DEFAULT='a'\"$(id)\"",
            "GRUB_DEFAULT=\"unterminated",
            "GRUB_THEME=/boot/grub/themes/My Theme/theme.txt",
            "GRUB_DEFAULT=\"a\\nb\"",
            "touch /root/x",
            "# $(id)",
            // Not a key the editor sets: a kernel command line is a root
            // shell at the next boot (init=/home/you/anything).
            "GRUB_CMDLINE_LINUX_DEFAULT=\"init=/home/u/x\"",
            "export GRUB_TIMEOUT=5",
        ] {
            assert!(check_grub_defaults(UBUNTU, &format!("{UBUNTU}{line}\n")).is_err(), "{line}");
        }
        // The distribution's own substitution is root's line; copied onto a
        // new line it is the request's.
        assert!(check_grub_defaults("", UBUNTU).is_err());
    }

    /// CachyOS's layout, as limine-entry-tool writes it.
    const LIMINE: &str = "timeout: 5\n\n/+CachyOS\n    comment: machine-id=abc\n\
        //linux-cachyos\n    protocol: linux\n    cmdline: quiet rw\n//Snapshots\n///2026-10-01 a/b\n    protocol: linux\n\
        /Windows #11\n    protocol: efi\n";

    #[test]
    fn only_the_two_settings_change() {
        let set = set_option(LIMINE, "default_entry", true, "CachyOS/linux-cachyos");
        assert_eq!(set, format!("default_entry: CachyOS/linux-cachyos\n{LIMINE}"));
        // Limine's names ignore case; every line that sets the key changes, nothing else.
        let set = set_option("TIMEOUT: 5\n/x\n    cmdline: a\ntimeout:3\n", "timeout", true, "no");
        assert_eq!(set, "timeout: no\n/x\n    cmdline: a\ntimeout: no\n");
        // A longer key or a comment is not the key.
        let sd = "#timeout 3\ntimeout_x 1\ndefault arch.conf\ntimeout 3\n";
        assert_eq!(set_option(sd, "timeout", false, "10"), "#timeout 3\ntimeout_x 1\ndefault arch.conf\ntimeout 10\n");
        assert_eq!(LIMINE.lines().find_map(|l| option_value(l, "timeout", true)), Some("5"));
        assert_eq!(sd.lines().find_map(|l| option_value(l, "default", false)), Some("arch.conf"));
    }

    #[test]
    fn limine_entries_are_named_by_their_path() {
        assert_eq!(limine_entries(LIMINE), ["CachyOS/linux-cachyos", "CachyOS/Snapshots/2026-10-01 a\\/b", "Windows \\#11"]);
    }

    #[test]
    fn submenu_entries_are_named_by_their_path() {
        let cfg = "function gfxmode {\n\tset gfxpayload=\"${1}\"\n}\n\
            menuentry 'Ubuntu' --class ubuntu $menuentry_id_option 'gnulinux-simple-x' {\n\tlinux /vmlinuz\n}\n\
            submenu 'Advanced options for Ubuntu' $menuentry_id_option 'gnulinux-advanced-x' {\n\
            \tmenuentry 'Ubuntu, with Linux 6.8.0-45-generic' --class ubuntu {\n\t\tif [ x = y ]; then\n\t\t  true\n\t\tfi\n\t}\n\
            \tmenuentry \"Ubuntu, with Linux 6.8.0-40-generic\" --class ubuntu {\n\t}\n}\n\
            menuentry 'UEFI Firmware Settings' $menuentry_id_option 'uefi-firmware' {\n\tfwsetup\n}\n";
        assert_eq!(
            menu_entries(cfg),
            [
                "Ubuntu",
                "Advanced options for Ubuntu>Ubuntu, with Linux 6.8.0-45-generic",
                "Advanced options for Ubuntu>Ubuntu, with Linux 6.8.0-40-generic",
                "UEFI Firmware Settings",
            ]
        );
    }

    #[test]
    fn bls_entries_are_read_only_where_grub_reads_them() {
        let dir = std::env::temp_dir().join(format!("posma-bls-test-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("scratch dir");
        let entry = |version: &str, title: &str| {
            fs::write(dir.join(format!("abc-{version}.conf")), format!("title {title}\nversion {version}\nlinux /vmlinuz-{version}\n"))
                .expect("entry")
        };
        entry("6.11.4-301.fc41.x86_64", "Fedora Linux (6.11.4-301.fc41.x86_64) 41");
        entry("6.12.5-200.fc41.x86_64", "Fedora Linux (6.12.5-200.fc41.x86_64) 41");
        entry("0-rescue", "Fedora Linux (0-rescue-abc) 41");

        let titles = bls_titles("insmod blscfg\nblscfg\n", &dir);
        assert_eq!(
            titles,
            ["Fedora Linux (6.12.5-200.fc41.x86_64) 41", "Fedora Linux (6.11.4-301.fc41.x86_64) 41", "Fedora Linux (0-rescue-abc) 41"]
        );
        assert!(bls_titles("menuentry 'x' {\n}\n", &dir).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
