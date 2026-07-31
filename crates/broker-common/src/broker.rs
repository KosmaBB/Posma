//! The `Broker` trait: one method per catalogued operation, every one of
//! them defaulted to an honest "not supported on this system".
//!
//! This is what makes bringing up a new OS additive rather than a rewrite —
//! a new broker is `impl Broker for MacBroker {}` (which already compiles
//! and answers every operation truthfully), and each operation gets
//! implemented by overriding one method, with the shared guards, dispatch,
//! transport and daemon/auth layers already in place.

use crate::guards;
use crate::ops::{PkgSource, Request, TrimMode};
use crate::result::{
    err, line, ok, BootEntries, CapabilityReport, CleanResult, ExecResult, Response, TextResult,
};
use std::path::Path;
use std::process::Command;

/// Runs one external command and captures its outcome. Shared because
/// every OS's implementations reduce to this once their own validation has
/// passed — and because doing it in one place keeps stdout/stderr handling
/// consistent across brokers.
pub fn run_capture(program: &str, args: &[String]) -> ExecResult {
    match Command::new(program).args(args).output() {
        Ok(out) if out.status.success() => ExecResult::ok(String::from_utf8_lossy(&out.stdout).into_owned()),
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            ExecResult {
                success: false,
                output: String::from_utf8_lossy(&out.stdout).into_owned(),
                error: Some(if stderr.is_empty() { "polecenie zakończyło się błędem".into() } else { stderr }),
            }
        }
        Err(e) => ExecResult::failed(e.to_string()),
    }
}

/// Same as `run_capture` but returns Result, for use as a `write_with_backup`
/// verification step.
pub fn run_verify(program: &str, args: &[String]) -> Result<String, String> {
    let result = run_capture(program, args);
    if result.success {
        Ok(result.output)
    } else {
        Err(result.error.unwrap_or_default())
    }
}

#[allow(unused_variables)]
pub trait Broker: Sync {
    /// Human-readable OS tag used in the capability report.
    fn os_name(&self) -> &'static str;

    /// Names of the operations this broker really implements. Keep in sync
    /// when overriding methods — it's what the UI uses to disable actions
    /// instead of letting the user discover unavailability by failing.
    fn implemented_ops(&self) -> Vec<&'static str> {
        Vec::new()
    }

    // ---------------------------------------------------------- fs-system
    fn clean_system_paths(&self, paths: Vec<String>) -> CleanResult {
        CleanResult::not_supported("clean_system_paths")
    }
    fn read_system_file(&self, path: String) -> Result<TextResult, String> {
        Err("read_system_file: operacja nieobsługiwana na tym systemie".into())
    }
    fn write_system_file(&self, path: String, content: String, keep_backups: u64) -> ExecResult {
        ExecResult::not_supported("write_system_file")
    }
    fn restore_system_file_backup(&self, path: String, filename: String, keep_backups: u64) -> ExecResult {
        ExecResult::not_supported("restore_system_file_backup")
    }
    fn install_directory(
        &self,
        source_dir: String,
        dest_name: String,
        activate_content: Option<String>,
        activate_path: Option<String>,
        keep_backups: u64,
    ) -> ExecResult {
        ExecResult::not_supported("install_directory")
    }

    // ----------------------------------------------------------- packages
    fn pkg_remove(&self, source: PkgSource, id: String) -> ExecResult {
        ExecResult::not_supported("pkg_remove")
    }
    fn pkg_remove_revision(&self, source: PkgSource, id: String, revision: u64) -> ExecResult {
        ExecResult::not_supported("pkg_remove_revision")
    }
    fn pkg_cache_clean(&self, source: PkgSource) -> ExecResult {
        ExecResult::not_supported("pkg_cache_clean")
    }
    fn pkg_autoremove(&self, source: PkgSource) -> ExecResult {
        ExecResult::not_supported("pkg_autoremove")
    }
    fn pkg_upgrade(&self, source: PkgSource, id: Option<String>) -> ExecResult {
        ExecResult::not_supported("pkg_upgrade")
    }

    // ----------------------------------------------------------- services
    fn service_set_enabled(&self, name: String, enabled: bool) -> ExecResult {
        ExecResult::not_supported("service_set_enabled")
    }
    fn service_set_running(&self, name: String, running: bool) -> ExecResult {
        ExecResult::not_supported("service_set_running")
    }
    fn autostart_system_set_enabled(&self, id: String, enabled: bool) -> ExecResult {
        ExecResult::not_supported("autostart_system_set_enabled")
    }

    // --------------------------------------------------------- boot/kernel
    fn remove_kernel(&self, package: String) -> ExecResult {
        ExecResult::not_supported("remove_kernel")
    }
    fn trim_system_logs(&self, mode: TrimMode, value: u64) -> ExecResult {
        ExecResult::not_supported("trim_system_logs")
    }
    fn read_boot_entries(&self) -> BootEntries {
        BootEntries::default()
    }

    // ---------------------------------------------------------- disk/SMART
    fn smart_read(&self, device: String) -> ExecResult {
        ExecResult::not_supported("smart_read")
    }

    // --------------------------------------------------------- Windows
    fn create_restore_point(&self, description: String) -> ExecResult {
        ExecResult::not_supported("create_restore_point")
    }
    fn component_store_cleanup(&self) -> ExecResult {
        ExecResult::not_supported("component_store_cleanup")
    }
    fn remove_appx_package(&self, id: String, all_users: bool) -> ExecResult {
        ExecResult::not_supported("remove_appx_package")
    }

    // ----------------------------------------------------------- macOS
    fn delete_local_snapshots(&self, keep_latest: bool) -> ExecResult {
        ExecResult::not_supported("delete_local_snapshots")
    }
    fn purge_system_caches(&self) -> ExecResult {
        ExecResult::not_supported("purge_system_caches")
    }
}

/// Generic implementation of `write_system_file` that any OS can delegate
/// to once it decides which paths it's willing to manage: full
/// backup-rotate-atomic-write-verify-rollback via the shared guards.
pub fn write_system_file_guarded<F>(
    path: &Path,
    content: String,
    keep_backups: u64,
    verify: F,
) -> ExecResult
where
    F: Fn() -> Result<String, String>,
{
    match guards::write_with_backup(path, &guards::backup_dir_for(path), &content, keep_backups, verify) {
        Ok(output) => ExecResult::ok(output),
        Err(e) => ExecResult::failed(e),
    }
}

/// Parses one request line and produces the response line. Every run mode
/// (one-shot stdin, Unix socket daemon, Windows named pipe) funnels through
/// this single function, so no transport can diverge in what it actually
/// does or which validation it applies.
pub fn handle_line<B: Broker + ?Sized>(broker: &B, input: &str) -> String {
    let request: Request = match serde_json::from_str(input.trim()) {
        Ok(r) => r,
        Err(e) => return line(&err::<()>(format!("invalid request: {e}"))),
    };

    match request {
        Request::CleanSystemPaths { paths } => line(&ok(broker.clean_system_paths(paths))),
        Request::ReadSystemFile { path } => match broker.read_system_file(path) {
            Ok(data) => line(&ok(data)),
            Err(e) => line(&err::<()>(e)),
        },
        Request::WriteSystemFile { path, content, keep_backups } => {
            line(&ok(broker.write_system_file(path, content, keep_backups)))
        }
        Request::RestoreSystemFileBackup { path, filename, keep_backups } => {
            line(&ok(broker.restore_system_file_backup(path, filename, keep_backups)))
        }
        Request::InstallDirectory { source_dir, dest_name, activate_content, activate_path, keep_backups } => line(&ok(
            broker.install_directory(source_dir, dest_name, activate_content, activate_path, keep_backups),
        )),

        Request::PkgRemove { source, id } => line(&ok(broker.pkg_remove(source, id))),
        Request::PkgRemoveRevision { source, id, revision } => line(&ok(broker.pkg_remove_revision(source, id, revision))),
        Request::PkgCacheClean { source } => line(&ok(broker.pkg_cache_clean(source))),
        Request::PkgAutoremove { source } => line(&ok(broker.pkg_autoremove(source))),
        Request::PkgUpgrade { source, id } => line(&ok(broker.pkg_upgrade(source, id))),

        Request::ServiceSetEnabled { name, enabled } => line(&ok(broker.service_set_enabled(name, enabled))),
        Request::ServiceSetRunning { name, running } => line(&ok(broker.service_set_running(name, running))),
        Request::AutostartSystemSetEnabled { id, enabled } => line(&ok(broker.autostart_system_set_enabled(id, enabled))),

        Request::RemoveKernel { package } => line(&ok(broker.remove_kernel(package))),
        Request::TrimSystemLogs { mode, value } => line(&ok(broker.trim_system_logs(mode, value))),
        Request::ReadBootEntries => line(&ok(broker.read_boot_entries())),

        Request::SmartRead { device } => line(&ok(broker.smart_read(device))),

        Request::CreateRestorePoint { description } => line(&ok(broker.create_restore_point(description))),
        Request::ComponentStoreCleanup => line(&ok(broker.component_store_cleanup())),
        Request::RemoveAppxPackage { id, all_users } => line(&ok(broker.remove_appx_package(id, all_users))),

        Request::DeleteLocalSnapshots { keep_latest } => line(&ok(broker.delete_local_snapshots(keep_latest))),
        Request::PurgeSystemCaches => line(&ok(broker.purge_system_caches())),

        Request::Capabilities => line(&ok(CapabilityReport {
            os: broker.os_name(),
            implemented: broker.implemented_ops(),
        })),
    }
}

/// Convenience for brokers whose response type is `Response<T>` already.
pub fn respond<T: serde::Serialize>(response: Response<T>) -> String {
    line(&response)
}
