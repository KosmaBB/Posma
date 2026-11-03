//! Privileged Windows broker (Access_plan.md §4).
//!
//! Windows is the platform the project builds "more blind" (no live test
//! machine), so this file is deliberately the most conservative of the
//! three — it implements only operations whose command form is unambiguous
//! and whose inputs are fully validated here, and leaves everything else to
//! the trait's honest not-supported defaults.
//!
//! Transport: the core starts this through UAC once per run, with
//! `--pipe`, and talks to it over a pipe the core created and serves only
//! to this process (see broker-common's `serve`). No installed helper.
//!
//! PowerShell reads `-Command` as a script, so each one is a fixed script
//! with the caller's value inserted once, in single quotes, after a check
//! that admits no quote and no separator (see `powershell`). Everything
//! else — winget, sc.exe, DISM — gets its arguments as arguments.

use broker_common::guards::{is_safe_package_id, windows_dir};
use broker_common::ops::PkgSource;
use broker_common::result::{CleanResult, ExecResult};
use broker_common::{run_capture_as, windows_services, Broker};

struct WindowsBroker;

/// What a console tool writes into a pipe is in the OEM code page, not
/// UTF-8: DISM's report in Polish would lose every ą and ł otherwise.
#[cfg(windows)]
fn oem_text(bytes: &[u8]) -> String {
    use windows_sys::Win32::Globalization::{MultiByteToWideChar, CP_OEMCP};
    let Ok(len) = i32::try_from(bytes.len()) else { return String::from_utf8_lossy(bytes).into_owned() };
    if len == 0 {
        return String::new();
    }
    // SAFETY: the first call only measures; the second fills a buffer of that size.
    let wide_len = unsafe { MultiByteToWideChar(CP_OEMCP, 0, bytes.as_ptr(), len, std::ptr::null_mut(), 0) };
    let mut wide = vec![0u16; wide_len.max(0) as usize];
    let written = unsafe { MultiByteToWideChar(CP_OEMCP, 0, bytes.as_ptr(), len, wide.as_mut_ptr(), wide_len) };
    String::from_utf16_lossy(&wide[..written.max(0) as usize])
}

#[cfg(not(windows))]
fn oem_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn run(program: &str, args: &[String]) -> ExecResult {
    run_capture_as(program, args, oem_text)
}

/// PowerShell is told to write UTF-8, so its errors read as they were written.
fn utf8(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim_start_matches('\u{feff}').to_string()
}

/// `-Command` joins every argument after it into one script and parses that
/// again, so a value given as an argument of its own is split at its
/// spaces. Each script is therefore built whole, with every value from the
/// request in single quotes — and the validation before it admits no quote.
fn powershell(script: String) -> ExecResult {
    let script = format!("[Console]::OutputEncoding = [Text.Encoding]::UTF8; {script}");
    run_capture_as("powershell.exe", &["-NoProfile".into(), "-NonInteractive".into(), "-Command".into(), script], utf8)
}

/// Letters, digits, spaces and dashes only, so it can sit in quotes as is.
fn restore_point_script(description: &str) -> String {
    let clean: String = description.chars().filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-').take(60).collect();
    let label = if clean.trim().is_empty() { "POSMA" } else { clean.trim() };
    format!("Checkpoint-Computer -Description '{label}' -RestorePointType MODIFY_SETTINGS")
}

/// DISM's own wording, in the system's language: there is nothing to parse
/// that the user would not read better as DISM wrote it.
fn dism(args: &[&str]) -> ExecResult {
    let args: Vec<String> = ["/Online", "/Cleanup-Image"].iter().chain(args).map(|a| a.to_string()).collect();
    run("dism.exe", &args)
}

impl Broker for WindowsBroker {
    fn os_name(&self) -> &'static str {
        "windows"
    }

    fn implemented_ops(&self) -> Vec<&'static str> {
        vec![
            "clean_system_paths",
            "pkg_upgrade",
            "service_set_enabled",
            "create_restore_point",
            "analyze_component_store",
            "component_store_cleanup",
        ]
    }

    /// The system temp folder and Windows Update's download cache, entries
    /// inside them only. A download in progress keeps its files open, so
    /// those come back as errors rather than going.
    fn clean_system_paths(&self, paths: Vec<String>) -> CleanResult {
        let Some(windows) = windows_dir() else {
            return CleanResult { errors: vec!["nie udało się ustalić katalogu Windows".into()], ..Default::default() };
        };
        broker_common::clean_within(paths, &[windows.join("Temp"), windows.join("SoftwareDistribution").join("Download")])
    }

    /// Elevated, so machine-wide installers update without asking each.
    fn pkg_upgrade(&self, source: PkgSource, id: Option<String>) -> ExecResult {
        if source != PkgSource::Winget {
            return ExecResult::failed(format!("{source:?}: nieobsługiwane źródło pakietu na Windows"));
        }
        let mut args: Vec<String> = vec!["upgrade".into()];
        match id {
            Some(id) if is_safe_package_id(&id) => args.extend(["--id".into(), id, "--exact".into()]),
            Some(id) => return ExecResult::failed(format!("{id}: nieprawidłowa nazwa pakietu — pominięto")),
            None => args.push("--all".into()),
        }
        args.extend(["--silent", "--disable-interactivity", "--accept-source-agreements", "--accept-package-agreements"].map(String::from));
        // winget writes UTF-8 itself.
        run_capture_as("winget", &args, utf8)
    }

    /// Only a service a profile lists. Off is `disabled` and stopped now;
    /// on is the start type Windows gives it, from the same list.
    fn service_set_enabled(&self, name: String, enabled: bool) -> ExecResult {
        let Some(service) = windows_services::find(&name) else {
            return ExecResult::failed(format!("{name}: tej usługi nie ma w żadnym profilu — odmowa"));
        };
        let start = if enabled { service.default_start } else { "disabled" };
        // `sc config <name> start= <type>` — the space after `start=` is sc's own grammar.
        let configured = run("sc.exe", &["config".into(), service.name.into(), "start=".into(), start.into()]);
        if !configured.success || enabled {
            return configured;
        }
        let stopped = run("sc.exe", &["stop".into(), service.name.into()]);
        // 1062: the service was not running, which is what was wanted.
        if stopped.success || stopped.output.contains("1062") {
            configured
        } else {
            stopped
        }
    }

    /// Access_plan.md makes a restore point mandatory before critical
    /// Windows operations — this is the operation those flows call first.
    fn create_restore_point(&self, description: String) -> ExecResult {
        powershell(restore_point_script(&description))
    }

    fn analyze_component_store(&self) -> ExecResult {
        dism(&["/AnalyzeComponentStore"])
    }

    fn component_store_cleanup(&self) -> ExecResult {
        dism(&["/StartComponentCleanup"])
    }
}

fn main() {
    broker_common::run_once(&WindowsBroker);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A description with spaces stays one value, and nothing in it can end
    /// the quotes — the separators a script needs are filtered out first.
    #[test]
    fn values_stay_inside_their_quotes() {
        assert_eq!(
            restore_point_script("Przed usunięciem; Remove-Item 'C:\\'"),
            "Checkpoint-Computer -Description 'Przed usunięciem Remove-Item C' -RestorePointType MODIFY_SETTINGS"
        );
        assert_eq!(restore_point_script("';"), "Checkpoint-Computer -Description 'POSMA' -RestorePointType MODIFY_SETTINGS");
    }

    /// A service off any profile is refused before sc.exe runs at all.
    #[test]
    fn an_unlisted_service_is_refused() {
        let answer = WindowsBroker.service_set_enabled("WinDefend".into(), false);
        assert!(!answer.success && answer.error.is_some_and(|e| e.contains("odmowa")));
    }
}
