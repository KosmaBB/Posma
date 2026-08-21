// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use tokio::sync::{mpsc::Receiver, Mutex};

// Capability catalog (Access_plan.md §2), the permission registry that
// tracks grant state against it (§6 step 2), and the Linux privileged
// broker (§6 step 3) that real elevated operations go through.
mod broker;
mod capabilities;
mod permissions;

use capabilities::CapabilityId;

/// The one system config file this app manages today. Passed explicitly to
/// the broker (rather than implied by the operation name) because the
/// broker protocol is now cross-OS and generic — the broker re-validates it
/// against its own closed list of managed files regardless.
const GRUB_CONFIG_PATH: &str = "/etc/default/grub";
use permissions::{AccessLevel, PermissionEntry, PermissionRegistry, PermissionStatus};

/// Spawns a sidecar module, sends one JSON request line over stdin and
/// returns the single JSON response line it prints to stdout.
async fn call_sidecar(
    app: &tauri::AppHandle,
    module: &str,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let (mut rx, mut child) = app
        .shell()
        .sidecar(module)
        .map_err(|e| e.to_string())?
        .spawn()
        .map_err(|e| e.to_string())?;

    let mut payload = serde_json::to_string(&request).map_err(|e| e.to_string())?;
    payload.push('\n');
    child.write(payload.as_bytes()).map_err(|e| e.to_string())?;

    // stderr is collected, not fatal: a module (or a library it links) may
    // emit warnings there before answering on stdout — the answer is what
    // counts. Collected stderr becomes the error only if the module exits
    // without ever producing a stdout line.
    let mut stderr_lines: Vec<String> = Vec::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                let text = String::from_utf8_lossy(&line);
                return serde_json::from_str(text.trim()).map_err(|e| e.to_string());
            }
            CommandEvent::Stderr(line) => {
                stderr_lines.push(String::from_utf8_lossy(&line).into_owned());
            }
            CommandEvent::Error(e) => return Err(e),
            CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }

    if stderr_lines.is_empty() {
        Err(format!("module {module} produced no output"))
    } else {
        Err(stderr_lines.join("\n"))
    }
}

/// The vault sidecar is the one exception to "spawn fresh per request":
/// unlike every other module, it needs to hold the derived encryption key
/// in memory across many actions without re-running Argon2id or re-asking
/// for the master password each time. So it's a single long-lived process,
/// started once and kept alive (its stdin/stdout pipes held open here)
/// until explicitly stopped or the app exits — see modules/vault/src/main.rs
/// for the protocol this talks.
struct VaultSession {
    child: CommandChild,
    rx: Receiver<CommandEvent>,
}

#[derive(Default)]
struct VaultState(Mutex<Option<VaultSession>>);

#[tauri::command]
async fn vault_start(app: tauri::AppHandle, state: tauri::State<'_, VaultState>) -> Result<(), String> {
    let mut guard = state.0.lock().await;
    if guard.is_some() {
        return Ok(());
    }
    let (rx, child) = app.shell().sidecar("vault").map_err(|e| e.to_string())?.spawn().map_err(|e| e.to_string())?;
    *guard = Some(VaultSession { child, rx });
    Ok(())
}

#[tauri::command]
async fn vault_stop(state: tauri::State<'_, VaultState>) -> Result<(), String> {
    let mut guard = state.0.lock().await;
    if let Some(session) = guard.take() {
        let _ = session.child.kill();
    }
    Ok(())
}

#[tauri::command]
async fn vault_request(state: tauri::State<'_, VaultState>, payload: serde_json::Value) -> Result<serde_json::Value, String> {
    let mut guard = state.0.lock().await;
    let session = guard.as_mut().ok_or("proces sejfu nie jest uruchomiony")?;

    let mut line = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    line.push('\n');
    session.child.write(line.as_bytes()).map_err(|e| e.to_string())?;

    while let Some(event) = session.rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                return serde_json::from_str(text.trim()).map_err(|e| e.to_string());
            }
            CommandEvent::Stderr(bytes) => {
                return Err(String::from_utf8_lossy(&bytes).into_owned());
            }
            CommandEvent::Error(e) => return Err(e),
            CommandEvent::Terminated(_) => {
                *guard = None;
                return Err("proces sejfu zakończył działanie".into());
            }
            _ => {}
        }
    }

    *guard = None;
    Err("proces sejfu nie odpowiedział".into())
}

#[tauri::command]
async fn get_system_info(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "system-info", serde_json::json!({ "cmd": "get_info" })).await
}

#[tauri::command]
async fn scan_temp(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "temp-clean", serde_json::json!({ "cmd": "scan" })).await
}

#[tauri::command]
async fn clean_temp(app: tauri::AppHandle, paths: Vec<String>) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "temp-clean", serde_json::json!({ "cmd": "clean", "paths": paths })).await
}

#[tauri::command]
async fn scan_duplicates(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "duplicates", serde_json::json!({ "cmd": "scan" })).await
}

#[tauri::command]
async fn clean_duplicates(app: tauri::AppHandle, paths: Vec<String>) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "duplicates", serde_json::json!({ "cmd": "clean", "paths": paths })).await
}

#[tauri::command]
async fn scan_duplicate_versions(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "duplicates", serde_json::json!({ "cmd": "scan_versions" })).await
}

#[tauri::command]
async fn clean_duplicate_versions(app: tauri::AppHandle, paths: Vec<String>) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "duplicates", serde_json::json!({ "cmd": "clean_versions", "paths": paths })).await
}

#[tauri::command]
async fn scan_big_files(
    app: tauri::AppHandle,
    min_size_mb: Option<u64>,
    max_results: Option<usize>,
) -> Result<serde_json::Value, String> {
    call_sidecar(
        &app,
        "big-files",
        serde_json::json!({ "cmd": "scan", "min_size_mb": min_size_mb, "max_results": max_results }),
    )
    .await
}

#[tauri::command]
async fn clean_big_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "big-files", serde_json::json!({ "cmd": "clean", "paths": paths })).await
}

/// desktop-theme runs entirely in the user's own home, so none of these
/// commands take a capability: there is nothing here to consent to that the
/// user could not do with a file manager and the settings app.
/// Records the level chosen at onboarding. Kept in the core, not only in
/// local storage: it decides whether a privileged grant survives a restart.
#[tauri::command]
async fn set_access_level(
    state: tauri::State<'_, PermissionRegistry>,
    level: AccessLevel,
) -> Result<(), String> {
    state.set_access_level(level).await;
    Ok(())
}

#[tauri::command]
async fn get_access_level(state: tauri::State<'_, PermissionRegistry>) -> Result<AccessLevel, String> {
    Ok(state.access_level().await)
}

#[tauri::command]
async fn scan_desktop_theme(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "desktop-theme", serde_json::json!({ "cmd": "scan" })).await
}

#[tauri::command]
async fn apply_desktop_theme(app: tauri::AppHandle, changes: serde_json::Value) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "desktop-theme", serde_json::json!({ "cmd": "apply", "changes": changes })).await
}

#[tauri::command]
async fn install_desktop_theme(app: tauri::AppHandle, source_dir: String, name: Option<String>) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "desktop-theme", serde_json::json!({ "cmd": "install_theme", "source_dir": source_dir, "name": name })).await
}

#[tauri::command]
async fn install_desktop_font(app: tauri::AppHandle, path: String) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "desktop-theme", serde_json::json!({ "cmd": "install_font", "path": path })).await
}

#[tauri::command]
async fn save_desktop_preset(app: tauri::AppHandle, name: String) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "desktop-theme", serde_json::json!({ "cmd": "save_preset", "name": name })).await
}

#[tauri::command]
async fn load_desktop_preset(app: tauri::AppHandle, name: String) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "desktop-theme", serde_json::json!({ "cmd": "load_preset", "name": name })).await
}

#[tauri::command]
async fn delete_desktop_preset(app: tauri::AppHandle, name: String) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "desktop-theme", serde_json::json!({ "cmd": "delete_preset", "name": name })).await
}

#[tauri::command]
async fn scan_autostart(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "autostart", serde_json::json!({ "cmd": "scan" })).await
}

#[tauri::command]
async fn toggle_autostart(app: tauri::AppHandle, id: String, enabled: bool) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "autostart", serde_json::json!({ "cmd": "toggle", "id": id, "enabled": enabled })).await
}

#[tauri::command]
async fn check_autostart_path(app: tauri::AppHandle, path: String) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "autostart", serde_json::json!({ "cmd": "check_path", "path": path })).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn add_autostart(
    app: tauri::AppHandle,
    id: Option<String>,
    name: String,
    path: String,
    args: Option<String>,
    icon: Option<String>,
    wrap_in_shell: bool,
    make_executable: bool,
) -> Result<serde_json::Value, String> {
    call_sidecar(
        &app,
        "autostart",
        serde_json::json!({
            "cmd": "add",
            "id": id,
            "name": name,
            "path": path,
            "args": args,
            "icon": icon,
            "wrap_in_shell": wrap_in_shell,
            "make_executable": make_executable,
        }),
    )
    .await
}

#[tauri::command]
async fn delete_autostart(app: tauri::AppHandle, id: String) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "autostart", serde_json::json!({ "cmd": "delete", "id": id })).await
}

#[tauri::command]
async fn shred_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "shredder", serde_json::json!({ "cmd": "shred", "paths": paths })).await
}

#[tauri::command]
async fn scan_disk_map(app: tauri::AppHandle, path: Option<String>) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "disk-map", serde_json::json!({ "cmd": "scan", "path": path })).await
}

#[tauri::command]
async fn scan_browser_hygiene(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "browser-hygiene", serde_json::json!({ "cmd": "scan" })).await
}

#[tauri::command]
async fn clean_browser_hygiene(app: tauri::AppHandle, paths: Vec<String>) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "browser-hygiene", serde_json::json!({ "cmd": "clean", "paths": paths })).await
}

#[tauri::command]
async fn health_snapshot(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "health-monitor", serde_json::json!({ "cmd": "snapshot" })).await
}

#[tauri::command]
async fn health_list_disks(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "health-monitor", serde_json::json!({ "cmd": "list_disks" })).await
}

#[tauri::command]
async fn health_smart(app: tauri::AppHandle, device: String) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "health-monitor", serde_json::json!({ "cmd": "smart", "device": device })).await
}

#[tauri::command]
async fn scan_uninstaller(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "uninstaller", serde_json::json!({ "cmd": "scan" })).await
}

#[tauri::command]
async fn clean_uninstaller(app: tauri::AppHandle, paths: Vec<String>) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "uninstaller", serde_json::json!({ "cmd": "clean", "paths": paths })).await
}

#[tauri::command]
async fn list_installed_apps(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "uninstaller", serde_json::json!({ "cmd": "list_apps" })).await
}

#[tauri::command]
async fn app_leftovers(app: tauri::AppHandle, app_ref: serde_json::Value, name: String) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "uninstaller", serde_json::json!({ "cmd": "app_leftovers", "app": app_ref, "name": name })).await
}

#[tauri::command]
async fn uninstall_app(app: tauri::AppHandle, app_ref: serde_json::Value) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "uninstaller", serde_json::json!({ "cmd": "uninstall", "app": app_ref })).await
}

#[tauri::command]
async fn inspect_metadata(app: tauri::AppHandle, paths: Vec<String>) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "metadata", serde_json::json!({ "cmd": "inspect", "paths": paths })).await
}

#[tauri::command]
async fn clean_metadata(app: tauri::AppHandle, items: Vec<serde_json::Value>) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "metadata", serde_json::json!({ "cmd": "clean", "items": items })).await
}

#[tauri::command]
async fn get_permissions(state: tauri::State<'_, PermissionRegistry>) -> Result<Vec<PermissionEntry>, String> {
    Ok(state.snapshot().await)
}

#[tauri::command]
async fn request_permission(
    state: tauri::State<'_, PermissionRegistry>,
    capability: CapabilityId,
) -> Result<PermissionStatus, String> {
    state.request(capability).await
}

#[tauri::command]
async fn deny_permission(state: tauri::State<'_, PermissionRegistry>, capability: CapabilityId) -> Result<(), String> {
    state.deny(capability).await;
    Ok(())
}

/// Deletes flat files directly inside /var/log via the privileged broker —
/// the operation temp-clean's own unprivileged "syslog" category cannot
/// perform itself. Gated on `fs-system` already being granted; the broker
/// re-validates every path itself regardless.
#[tauri::command]
async fn journal_usage(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "journald-trim", serde_json::json!({ "cmd": "usage" })).await
}

#[tauri::command]
async fn clean_system_paths(
    state: tauri::State<'_, PermissionRegistry>,
    paths: Vec<String>,
) -> Result<serde_json::Value, String> {
    state.require_operation("clean_system_paths").await?;
    broker::call_broker(serde_json::json!({ "op": "clean_system_paths", "paths": paths })).await
}

/// Removes an apt/snap package via the privileged broker. modules/uninstaller's
/// own `uninstall_app` always fails for these two sources (needs root);
/// flatpak keeps using that unprivileged path since it has its own
/// escalation. Gated on `pkg` already granted; the broker re-validates the
/// package id itself regardless.
/// Trims the systemd journal via the privileged broker (journalctl
/// --vacuum-size/--vacuum-time always need root). `mode` is `"size"`
/// (megabytes) or `"time"` (days); the broker re-validates both
/// independently of whatever the frontend already checked.
#[tauri::command]
async fn vacuum_journal(
    state: tauri::State<'_, PermissionRegistry>,
    mode: String,
    value: u64,
) -> Result<serde_json::Value, String> {
    state.require_operation("vacuum_journal").await?;
    broker::call_broker(serde_json::json!({ "op": "trim_system_logs", "mode": mode, "value": value })).await
}

#[tauri::command]
async fn scan_pkg_cache(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "pkg-cache", serde_json::json!({ "cmd": "scan" })).await
}

#[tauri::command]
async fn apt_clean(state: tauri::State<'_, PermissionRegistry>) -> Result<serde_json::Value, String> {
    state.require_operation("apt_clean").await?;
    broker::call_broker(serde_json::json!({ "op": "pkg_cache_clean", "source": "apt" })).await
}

#[tauri::command]
async fn apt_autoremove(state: tauri::State<'_, PermissionRegistry>) -> Result<serde_json::Value, String> {
    state.require_operation("apt_autoremove").await?;
    broker::call_broker(serde_json::json!({ "op": "pkg_autoremove", "source": "apt" })).await
}

#[tauri::command]
async fn snap_remove_revision(
    state: tauri::State<'_, PermissionRegistry>,
    name: String,
    revision: u64,
) -> Result<serde_json::Value, String> {
    state.require_operation("snap_remove_revision").await?;
    broker::call_broker(serde_json::json!({ "op": "pkg_remove_revision", "source": "snap", "id": name, "revision": revision })).await
}

#[tauri::command]
async fn scan_kernels(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "kernel-mgr", serde_json::json!({ "cmd": "scan" })).await
}

/// Gated on both `boot` and `pkg` (module.json declares both) — the broker
/// re-derives the running/latest-kernel lock itself regardless (see
/// remove_kernel in linux-broker), this is just the consent gate.
#[tauri::command]
async fn remove_kernel(
    state: tauri::State<'_, PermissionRegistry>,
    package: String,
) -> Result<serde_json::Value, String> {
    state.require_operation("remove_kernel").await?;
    state.require_operation("remove_kernel").await?;
    broker::call_broker(serde_json::json!({ "op": "remove_kernel", "package": package })).await
}

#[tauri::command]
async fn scan_grub(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "grub-editor", serde_json::json!({ "cmd": "scan" })).await
}

#[tauri::command]
async fn list_grub_presets(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "grub-editor", serde_json::json!({ "cmd": "list_presets" })).await
}

#[tauri::command]
async fn load_grub_preset(app: tauri::AppHandle, name: String) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "grub-editor", serde_json::json!({ "cmd": "load_preset", "name": name })).await
}

#[tauri::command]
async fn save_grub_preset(app: tauri::AppHandle, name: String, content: String) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "grub-editor", serde_json::json!({ "cmd": "save_preset", "name": name, "content": content })).await
}

#[tauri::command]
async fn delete_grub_preset(app: tauri::AppHandle, name: String) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "grub-editor", serde_json::json!({ "cmd": "delete_preset", "name": name })).await
}

#[tauri::command]
async fn inspect_grub_theme(app: tauri::AppHandle, path: String) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "grub-editor", serde_json::json!({ "cmd": "inspect_theme", "path": path })).await
}

#[tauri::command]
async fn preview_grub_theme(app: tauri::AppHandle, theme_dir: String) -> Result<serde_json::Value, String> {
    call_sidecar(&app, "grub-editor", serde_json::json!({ "cmd": "preview_theme", "theme_dir": theme_dir })).await
}

#[tauri::command]
async fn write_grub_config(
    state: tauri::State<'_, PermissionRegistry>,
    content: String,
    keep_backups: u64,
) -> Result<serde_json::Value, String> {
    state.require_operation("write_grub_config").await?;
    broker::call_broker(serde_json::json!({ "op": "write_system_file", "path": GRUB_CONFIG_PATH, "content": content, "keep_backups": keep_backups })).await
}

#[tauri::command]
async fn install_grub_theme(
    state: tauri::State<'_, PermissionRegistry>,
    source_dir: String,
    name: String,
    content: String,
    keep_backups: u64,
) -> Result<serde_json::Value, String> {
    state.require_operation("install_grub_theme").await?;
    broker::call_broker(
        serde_json::json!({ "op": "install_directory", "source_dir": source_dir, "dest_name": name, "activate_content": content, "activate_path": GRUB_CONFIG_PATH, "keep_backups": keep_backups }),
    )
    .await
}

#[tauri::command]
async fn restore_grub_backup(
    state: tauri::State<'_, PermissionRegistry>,
    filename: String,
    keep_backups: u64,
) -> Result<serde_json::Value, String> {
    state.require_operation("restore_grub_backup").await?;
    broker::call_broker(serde_json::json!({ "op": "restore_system_file_backup", "path": GRUB_CONFIG_PATH, "filename": filename, "keep_backups": keep_backups })).await
}

#[tauri::command]
async fn read_boot_entries(state: tauri::State<'_, PermissionRegistry>) -> Result<serde_json::Value, String> {
    state.require_operation("read_boot_entries").await?;
    broker::call_broker(serde_json::json!({ "op": "read_boot_entries" })).await
}

/// Asks this OS's broker which catalogued operations it actually
/// implements, so the UI can disable unavailable actions up front instead
/// of letting the user find out by failing. Deliberately NOT permission-
/// gated: it performs nothing, and knowing what's possible shouldn't
/// require consenting to anything.
#[tauri::command]
async fn broker_capabilities() -> Result<serde_json::Value, String> {
    broker::call_broker(serde_json::json!({ "op": "capabilities" })).await
}

#[tauri::command]
async fn uninstall_pkg_privileged(
    state: tauri::State<'_, PermissionRegistry>,
    source: String,
    id: String,
) -> Result<serde_json::Value, String> {
    state.require_operation("uninstall_pkg_privileged").await?;
    broker::call_broker(serde_json::json!({ "op": "pkg_remove", "source": source, "id": id })).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(VaultState::default())
        .setup(|app| {
            let permissions_path = app.path().app_data_dir()?.join("permissions.json");
            app.manage(PermissionRegistry::load(permissions_path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_system_info,
            scan_temp,
            clean_temp,
            scan_duplicates,
            clean_duplicates,
            scan_duplicate_versions,
            clean_duplicate_versions,
            scan_big_files,
            clean_big_files,
            set_access_level,
            get_access_level,
            scan_desktop_theme,
            apply_desktop_theme,
            install_desktop_theme,
            install_desktop_font,
            save_desktop_preset,
            load_desktop_preset,
            delete_desktop_preset,
            scan_autostart,
            toggle_autostart,
            check_autostart_path,
            add_autostart,
            delete_autostart,
            shred_files,
            inspect_metadata,
            clean_metadata,
            scan_disk_map,
            scan_browser_hygiene,
            clean_browser_hygiene,
            health_snapshot,
            health_list_disks,
            health_smart,
            scan_uninstaller,
            clean_uninstaller,
            list_installed_apps,
            app_leftovers,
            uninstall_app,
            vault_start,
            vault_stop,
            vault_request,
            get_permissions,
            request_permission,
            deny_permission,
            clean_system_paths,
            uninstall_pkg_privileged,
            journal_usage,
            vacuum_journal,
            scan_pkg_cache,
            apt_clean,
            apt_autoremove,
            snap_remove_revision,
            scan_kernels,
            remove_kernel,
            scan_grub,
            list_grub_presets,
            load_grub_preset,
            save_grub_preset,
            delete_grub_preset,
            inspect_grub_theme,
            preview_grub_theme,
            write_grub_config,
            install_grub_theme,
            restore_grub_backup,
            read_boot_entries,
            broker_capabilities
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
