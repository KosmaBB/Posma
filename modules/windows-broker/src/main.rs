//! Privileged Windows broker (Access_plan.md §4).
//!
//! Scaffold: speaks the full shared protocol and reports capabilities
//! honestly. Windows is the platform the project plans to build "more
//! blind" (no live test machine), so this file is deliberately the most
//! conservative of the three — it implements only operations whose command
//! form is unambiguous and whose inputs are fully validated here, and
//! leaves everything else to the trait's honest not-supported defaults.
//!
//! Transport: `run_once` under a UAC-elevated launch is the intended
//! cold-start path. The Unix-socket daemon from broker-common does NOT
//! apply here — the Windows equivalent is a named pipe plus a peer check
//! via `GetNamedPipeClientProcessId`, which is exactly the kind of
//! security-critical step that must not be written without a machine to
//! verify it on, so it is intentionally absent rather than guessed.
//!
//! Every PowerShell invocation below passes arguments through
//! `-EncodedCommand`-free, single-purpose command lines with
//! independently-validated inputs — no string interpolation of unchecked
//! caller data into a script body.

use broker_common::guards::{is_safe_name, is_safe_package_id};
use broker_common::ops::PkgSource;
use broker_common::result::ExecResult;
use broker_common::{run_capture, Broker};

struct WindowsBroker;

impl Broker for WindowsBroker {
    fn os_name(&self) -> &'static str {
        "windows"
    }

    fn implemented_ops(&self) -> Vec<&'static str> {
        vec![
            "pkg_remove",
            "pkg_upgrade",
            "service_set_enabled",
            "service_set_running",
            "create_restore_point",
            "component_store_cleanup",
            "remove_appx_package",
        ]
    }

    fn pkg_remove(&self, source: PkgSource, id: String) -> ExecResult {
        if !is_safe_package_id(&id) {
            return ExecResult::failed(format!("{id}: nieprawidłowa nazwa pakietu — pominięto"));
        }
        match source {
            PkgSource::Winget => run_capture(
                "winget",
                &[
                    "uninstall".into(),
                    "--id".into(),
                    id,
                    "--silent".into(),
                    "--accept-source-agreements".into(),
                ],
            ),
            other => ExecResult::failed(format!("{other:?}: nieobsługiwane źródło pakietu na Windows")),
        }
    }

    fn pkg_upgrade(&self, source: PkgSource, id: Option<String>) -> ExecResult {
        match source {
            PkgSource::Winget => {
                let mut args: Vec<String> = vec!["upgrade".into()];
                match id {
                    Some(id) => {
                        if !is_safe_package_id(&id) {
                            return ExecResult::failed(format!("{id}: nieprawidłowa nazwa pakietu — pominięto"));
                        }
                        args.push("--id".into());
                        args.push(id);
                    }
                    None => args.push("--all".into()),
                }
                args.push("--silent".into());
                args.push("--accept-source-agreements".into());
                args.push("--accept-package-agreements".into());
                run_capture("winget", &args)
            }
            other => ExecResult::failed(format!("{other:?}: nieobsługiwane źródło pakietu na Windows")),
        }
    }

    fn service_set_enabled(&self, name: String, enabled: bool) -> ExecResult {
        if !is_safe_name(&name) {
            return ExecResult::failed(format!("{name}: nieprawidłowa nazwa usługi"));
        }
        let start_type = if enabled { "auto" } else { "disabled" };
        // `sc.exe config <name> start= <type>` — the space after `start=`
        // is required by sc's own argument grammar.
        run_capture("sc.exe", &["config".into(), name, "start=".into(), start_type.into()])
    }

    fn service_set_running(&self, name: String, running: bool) -> ExecResult {
        if !is_safe_name(&name) {
            return ExecResult::failed(format!("{name}: nieprawidłowa nazwa usługi"));
        }
        let verb = if running { "start" } else { "stop" };
        run_capture("sc.exe", &[verb.into(), name])
    }

    /// Access_plan.md makes a restore point mandatory before critical
    /// Windows operations — this is the operation those flows call first.
    fn create_restore_point(&self, description: String) -> ExecResult {
        let clean: String = description.chars().filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-').take(60).collect();
        let label = if clean.trim().is_empty() { "POSMA".to_string() } else { clean };
        run_capture(
            "powershell.exe",
            &[
                "-NoProfile".into(),
                "-NonInteractive".into(),
                "-Command".into(),
                "Checkpoint-Computer".into(),
                "-Description".into(),
                label,
                "-RestorePointType".into(),
                "MODIFY_SETTINGS".into(),
            ],
        )
    }

    fn component_store_cleanup(&self) -> ExecResult {
        run_capture(
            "dism.exe",
            &["/Online".into(), "/Cleanup-Image".into(), "/StartComponentCleanup".into()],
        )
    }

    fn remove_appx_package(&self, id: String, all_users: bool) -> ExecResult {
        if !is_safe_package_id(&id) {
            return ExecResult::failed(format!("{id}: nieprawidłowa nazwa pakietu — pominięto"));
        }
        let mut args: Vec<String> = vec![
            "-NoProfile".into(),
            "-NonInteractive".into(),
            "-Command".into(),
            "Remove-AppxPackage".into(),
            "-Package".into(),
            id,
        ];
        if all_users {
            args.push("-AllUsers".into());
        }
        run_capture("powershell.exe", &args)
    }
}

fn main() {
    // No daemon mode: see the module docs — the Windows peer-authentication
    // step is deliberately not written blind.
    broker_common::run_once(&WindowsBroker);
}
