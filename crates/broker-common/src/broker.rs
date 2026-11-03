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
    err, line, ok, BootEntries, CapabilityReport, CleanResult, ExecResult,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Runs one external command and captures its outcome. Shared because
/// every OS's implementations reduce to this once their own validation has
/// passed — and because doing it in one place keeps stdout/stderr handling
/// consistent across brokers.
pub fn run_capture(program: &str, args: &[String]) -> ExecResult {
    run_capture_as(program, args, |bytes| String::from_utf8_lossy(bytes).into_owned())
}

/// `run_capture` for a program whose output is not UTF-8 — a Windows
/// console tool writes its OEM code page into a pipe.
pub fn run_capture_as(program: &str, args: &[String], text: fn(&[u8]) -> String) -> ExecResult {
    match Command::new(program).args(args).output() {
        Ok(out) if out.status.success() => ExecResult::ok(text(&out.stdout)),
        Ok(out) => {
            let stderr = text(&out.stderr).trim().to_string();
            ExecResult {
                success: false,
                output: text(&out.stdout),
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

    // --------------------------------------------------------- boot/kernel
    fn remove_kernel(&self, package: String) -> ExecResult {
        ExecResult::not_supported("remove_kernel")
    }
    fn trim_system_logs(&self, mode: TrimMode, value: u64) -> ExecResult {
        ExecResult::not_supported("trim_system_logs")
    }
    fn read_boot_entries(&self) -> Result<BootEntries, String> {
        Ok(BootEntries::default())
    }
    fn set_boot_options(&self, default_entry: Option<String>, timeout: Option<String>, keep_backups: u64) -> ExecResult {
        ExecResult::not_supported("set_boot_options")
    }

    // ---------------------------------------------------------- disk/SMART
    fn smart_read(&self, device: String) -> ExecResult {
        ExecResult::not_supported("smart_read")
    }

    // --------------------------------------------------------- Windows
    fn create_restore_point(&self, description: String) -> ExecResult {
        ExecResult::not_supported("create_restore_point")
    }
    fn analyze_component_store(&self) -> ExecResult {
        ExecResult::not_supported("analyze_component_store")
    }
    fn component_store_cleanup(&self) -> ExecResult {
        ExecResult::not_supported("component_store_cleanup")
    }

    // ----------------------------------------------------------- macOS
    fn delete_local_snapshots(&self, keep_latest: bool) -> ExecResult {
        ExecResult::not_supported("delete_local_snapshots")
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

/// Bytes in a file or a whole tree, links not followed.
fn tree_size(path: &Path) -> u64 {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() => fs::read_dir(path)
            .map(|entries| entries.flatten().map(|e| tree_size(&e.path())).sum())
            .unwrap_or(0),
        Ok(meta) => meta.len(),
        Err(_) => 0,
    }
}

/// `clean_system_paths` for a broker whose rule is "anything inside one of
/// these directories": each path is checked against `roots` here, as root,
/// and a root itself is never accepted. A link is removed, not followed.
pub fn clean_within(paths: Vec<String>, roots: &[PathBuf]) -> CleanResult {
    let mut result = CleanResult::default();
    for raw in paths {
        let path = PathBuf::from(&raw);
        if !roots.iter().any(|root| guards::contained_in(&path, root)) {
            result.errors.push(format!("{raw}: poza dozwolonymi lokalizacjami — pominięto"));
            continue;
        }
        let size = tree_size(&path);
        let removed = match fs::symlink_metadata(&path) {
            Ok(meta) if meta.is_dir() => fs::remove_dir_all(&path),
            _ => fs::remove_file(&path),
        };
        match removed {
            Ok(()) => {
                result.freed_bytes += size;
                result.removed += 1;
            }
            Err(e) => result.errors.push(format!("{raw}: {e}")),
        }
    }
    result
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

        Request::RemoveKernel { package } => line(&ok(broker.remove_kernel(package))),
        Request::TrimSystemLogs { mode, value } => line(&ok(broker.trim_system_logs(mode, value))),
        Request::ReadBootEntries => match broker.read_boot_entries() {
            Ok(data) => line(&ok(data)),
            Err(e) => line(&err::<()>(e)),
        },
        Request::SetBootOptions { default_entry, timeout, keep_backups } => {
            line(&ok(broker.set_boot_options(default_entry, timeout, keep_backups)))
        }

        Request::SmartRead { device } => line(&ok(broker.smart_read(device))),

        Request::CreateRestorePoint { description } => line(&ok(broker.create_restore_point(description))),
        Request::AnalyzeComponentStore => line(&ok(broker.analyze_component_store())),
        Request::ComponentStoreCleanup => line(&ok(broker.component_store_cleanup())),

        Request::DeleteLocalSnapshots { keep_latest } => line(&ok(broker.delete_local_snapshots(keep_latest))),

        Request::Capabilities => line(&ok(CapabilityReport {
            os: broker.os_name(),
            implemented: broker.implemented_ops(),
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What is inside a root goes, with its size; the root itself and
    /// anything beside it stay.
    #[test]
    fn only_what_is_inside_a_root_is_removed() {
        let base = std::env::temp_dir().join(format!("posma-clean-within-{}", std::process::id()));
        let root = base.join("root");
        fs::create_dir_all(root.join("dir")).unwrap();
        fs::write(root.join("dir/a"), b"12345").unwrap();
        fs::write(base.join("outside"), b"x").unwrap();

        let paths = [root.join("dir"), base.join("outside"), root.clone()].map(|p| p.to_string_lossy().into_owned());
        let result = clean_within(paths.to_vec(), std::slice::from_ref(&root));

        assert_eq!((result.removed, result.freed_bytes, result.errors.len()), (1, 5, 2), "{:?}", result.errors);
        assert!(!root.join("dir").exists() && root.exists() && base.join("outside").exists());
        let _ = fs::remove_dir_all(&base);
    }
}
