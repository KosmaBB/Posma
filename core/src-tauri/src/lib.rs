// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use tokio::sync::{mpsc::Receiver, Mutex};

// Capability catalog (Access_plan.md §2), the permission registry that
// tracks grant state against it (§6 step 2), and the privileged broker
// (§6 step 3) that real elevated operations go through.
mod broker;
mod capabilities;
mod permissions;
mod profile;

use capabilities::CapabilityId;

/// The one system config file this app manages today. Passed explicitly to
/// the broker (rather than implied by the operation name) because the
/// broker protocol is now cross-OS and generic — the broker re-validates it
/// against its own closed list of managed files regardless.
const GRUB_CONFIG_PATH: &str = "/etc/default/grub";
use permissions::{AccessLevel, PermissionRegistry, PermissionStatus};
use profile::{ProfileOverrides, ProfileStore};

/// Spawns a sidecar module, sends one JSON request line over stdin and
/// returns the single JSON response line it prints to stdout. Every module
/// starts with the user's corrections to the system profile in its
/// environment.
async fn call_sidecar(
    app: &tauri::AppHandle,
    module: &str,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let (mut rx, mut child) = app
        .shell()
        .sidecar(format!("posma-{module}"))
        .map_err(|e| e.to_string())?
        .envs(app.state::<ProfileStore>().get().env())
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

/// Any request to an unprivileged module. No capability gate: a module runs
/// as the user and checks its own input, so the interface could do nothing
/// through it that the user cannot already. Only modules the catalog lists
/// start — the name becomes a path next to the executable.
#[tauri::command]
async fn call_module(app: tauri::AppHandle, module: String, request: serde_json::Value) -> Result<serde_json::Value, String> {
    if !capabilities::is_module(&module) {
        return Err(format!("moduł {module} nie występuje w access/catalog.json — odmowa"));
    }
    call_sidecar(&app, &module, request).await
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
    let (rx, child) = app.shell().sidecar("posma-vault").map_err(|e| e.to_string())?.spawn().map_err(|e| e.to_string())?;
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

/// The Linux system profile: what detection found and, where the user
/// corrected it, the correction — plus the stored corrections themselves,
/// which the profile alone cannot tell apart from detection.
#[tauri::command]
async fn get_system_profile(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let mut profile = call_sidecar(&app, "system-info", serde_json::json!({ "cmd": "profile" })).await?;
    if let Some(data) = profile.get_mut("data").and_then(|d| d.as_object_mut()) {
        let overrides = app.state::<ProfileStore>().get();
        data.insert("overrides".into(), serde_json::to_value(overrides).map_err(|e| e.to_string())?);
    }
    Ok(profile)
}

/// Stores the user's corrections and answers with the profile as every
/// module will now see it.
#[tauri::command]
async fn set_system_profile(
    app: tauri::AppHandle,
    store: tauri::State<'_, ProfileStore>,
    overrides: ProfileOverrides,
) -> Result<serde_json::Value, String> {
    store.set(overrides)?;
    get_system_profile(app).await
}

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

/// Deleting local Time Machine snapshots is the broker's, which lists them
/// again as root.
#[tauri::command]
async fn delete_local_snapshots(
    state: tauri::State<'_, PermissionRegistry>,
    keep_latest: bool,
) -> Result<serde_json::Value, String> {
    state.require_operation("delete_local_snapshots").await?;
    broker::call_broker(serde_json::json!({ "op": "delete_local_snapshots", "keep_latest": keep_latest })).await
}

/// The reason in a broker answer that did not succeed.
fn broker_failure(answer: &serde_json::Value) -> String {
    answer["data"]["error"].as_str().or(answer["error"].as_str()).unwrap_or("nieznany błąd").to_string()
}

/// A System Restore point before a critical Windows change, and without one
/// no change: Access_plan.md makes it a condition, not an option. `operation`
/// names the catalog entry of the module asking, so its grant is checked.
async fn restore_point(state: &PermissionRegistry, operation: &str, description: &str) -> Result<(), String> {
    state.require_operation(operation).await?;
    let point = broker::call_broker(serde_json::json!({ "op": "create_restore_point", "description": description })).await?;
    if point["data"]["success"] == true {
        return Ok(());
    }
    Err(format!(
        "Nie udało się utworzyć punktu przywracania, więc nic nie zostało zmienione. Potrzebna jest włączona \
         Ochrona systemu dla dysku C: (Panel sterowania → Odzyskiwanie). ({})",
        broker_failure(&point)
    ))
}

/// Removes the picked apps for this account, after a restore point. The
/// module removes them itself: they are the account's own.
#[tauri::command]
async fn remove_bloatware(
    app: tauri::AppHandle,
    state: tauri::State<'_, PermissionRegistry>,
    packages: Vec<String>,
) -> Result<serde_json::Value, String> {
    restore_point(&state, "bloatware_restore_point", "POSMA przed usunieciem aplikacji").await?;
    call_sidecar(&app, "bloatware", serde_json::json!({ "cmd": "remove", "packages": packages })).await
}

/// Switches the services of a profile off, or back to their Windows
/// defaults, after one restore point. The broker accepts only services a
/// profile lists, and decides the start type itself.
#[tauri::command]
async fn set_services(
    state: tauri::State<'_, PermissionRegistry>,
    names: Vec<String>,
    enabled: bool,
) -> Result<serde_json::Value, String> {
    state.require_operation("set_services").await?;
    restore_point(&state, "services_restore_point", "POSMA przed zmiana uslug").await?;
    let mut changed = Vec::new();
    let mut errors = Vec::new();
    for name in names {
        match broker::call_broker(serde_json::json!({ "op": "service_set_enabled", "name": name, "enabled": enabled })).await {
            Ok(answer) if answer["data"]["success"] == true => changed.push(name),
            Ok(answer) => errors.push(format!("{name}: {}", broker_failure(&answer))),
            Err(e) => errors.push(format!("{name}: {e}")),
        }
    }
    Ok(serde_json::json!({ "ok": true, "data": { "changed": changed, "errors": errors } }))
}

/// DISM's report on the component store — the preview before cleaning it.
#[tauri::command]
async fn analyze_component_store(state: tauri::State<'_, PermissionRegistry>) -> Result<serde_json::Value, String> {
    state.require_operation("analyze_component_store").await?;
    broker::call_broker(serde_json::json!({ "op": "analyze_component_store" })).await
}

#[tauri::command]
async fn clean_component_store(state: tauri::State<'_, PermissionRegistry>) -> Result<serde_json::Value, String> {
    state.require_operation("clean_component_store").await?;
    restore_point(&state, "winsxs_restore_point", "POSMA przed czyszczeniem WinSxS").await?;
    broker::call_broker(serde_json::json!({ "op": "component_store_cleanup" })).await
}

/// Updates the picked applications one by one, elevated. No restore point:
/// an update replaces an application, not the system.
#[tauri::command]
async fn winget_upgrade(state: tauri::State<'_, PermissionRegistry>, ids: Vec<String>) -> Result<serde_json::Value, String> {
    state.require_operation("winget_upgrade").await?;
    let mut upgraded = Vec::new();
    let mut errors = Vec::new();
    for id in ids {
        match broker::call_broker(serde_json::json!({ "op": "pkg_upgrade", "source": "winget", "id": id })).await {
            Ok(answer) if answer["data"]["success"] == true => upgraded.push(id),
            Ok(answer) => errors.push(format!("{id}: {}", broker_failure(&answer))),
            Err(e) => errors.push(format!("{id}: {e}")),
        }
    }
    Ok(serde_json::json!({ "ok": true, "data": { "upgraded": upgraded, "errors": errors } }))
}

/// Raw ATA/NVMe passthrough needs root, so this goes through the broker
/// rather than the sidecar. It was wired to the sidecar, which can only ever
/// come back with a permission error — the module's own comment said as much.
///
/// The broker hands back smartctl's own output; reading it stays with the
/// module, the same code that reads it when no root is needed.
#[tauri::command]
async fn health_smart(
    app: tauri::AppHandle,
    state: tauri::State<'_, PermissionRegistry>,
    device: String,
) -> Result<serde_json::Value, String> {
    // macOS gives SMART to an ordinary user, and its smartctl comes from a
    // Homebrew prefix the user owns, which a root broker must never run.
    if cfg!(target_os = "macos") {
        return call_sidecar(&app, "health-monitor", serde_json::json!({ "cmd": "smart", "device": device })).await;
    }
    state.require_operation("health_smart").await?;
    let raw = broker::call_broker(serde_json::json!({ "op": "smart_read", "device": device })).await?;
    let Some(data) = raw.get("data").filter(|_| raw["ok"] == true) else {
        return Ok(raw);
    };
    let request = serde_json::json!({
        "cmd": "smart_report",
        "device": device,
        "output": data["output"],
        "error": data["error"],
    });
    call_sidecar(&app, "health-monitor", request).await
}

#[tauri::command]
async fn request_permission(
    state: tauri::State<'_, PermissionRegistry>,
    capability: CapabilityId,
) -> Result<PermissionStatus, String> {
    state.request(capability).await
}

/// Whether macOS has given POSMA Full Disk Access — always so elsewhere.
#[tauri::command]
fn full_disk_access() -> bool {
    permissions::full_disk_access()
}

/// Opens the one System Settings pane that grants Full Disk Access; macOS
/// lets no program grant it to itself.
#[tauri::command]
fn open_full_disk_access_settings() -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("Pełny dostęp do dysku istnieje tylko na macOS".into());
    }
    let opened = std::process::Command::new("/usr/bin/open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
        .status()
        .map_err(|e| e.to_string())?;
    if opened.success() { Ok(()) } else { Err("nie udało się otworzyć Ustawień systemowych".into()) }
}

/// Deletes flat files directly inside /var/log via the privileged broker —
/// the operation temp-clean's own unprivileged "syslog" category cannot
/// perform itself. Gated on `fs-system` already being granted; the broker
/// re-validates every path itself regardless.
#[tauri::command]
async fn clean_system_paths(
    state: tauri::State<'_, PermissionRegistry>,
    paths: Vec<String>,
) -> Result<serde_json::Value, String> {
    state.require_operation("clean_system_paths").await?;
    broker::call_broker(serde_json::json!({ "op": "clean_system_paths", "paths": paths })).await
}

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

/// `source` is the manager the scan reported for this system (apt, pacman,
/// dnf, zypper). The broker checks it against the machine itself and
/// refuses a mismatch, so it names the manager rather than choosing it.
#[tauri::command]
async fn pkg_cache_clean(state: tauri::State<'_, PermissionRegistry>, source: String) -> Result<serde_json::Value, String> {
    state.require_operation("pkg_cache_clean").await?;
    broker::call_broker(serde_json::json!({ "op": "pkg_cache_clean", "source": source })).await
}

#[tauri::command]
async fn pkg_autoremove(state: tauri::State<'_, PermissionRegistry>, source: String) -> Result<serde_json::Value, String> {
    state.require_operation("pkg_autoremove").await?;
    broker::call_broker(serde_json::json!({ "op": "pkg_autoremove", "source": source })).await
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

/// Gated on both `boot` and `pkg` (module.json declares both) — the broker
/// re-derives the running/latest-kernel lock itself regardless (see
/// remove_kernel in linux-broker), this is just the consent gate.
#[tauri::command]
async fn remove_kernel(
    state: tauri::State<'_, PermissionRegistry>,
    package: String,
) -> Result<serde_json::Value, String> {
    state.require_operation("remove_kernel").await?;
    state.require_operation("remove_kernel_package").await?;
    broker::call_broker(serde_json::json!({ "op": "remove_kernel", "package": package })).await
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

/// `path` names another loader's config, as `read_boot_entries` reported
/// it; the broker accepts only the one this machine boots through.
#[tauri::command]
async fn restore_grub_backup(
    state: tauri::State<'_, PermissionRegistry>,
    filename: String,
    keep_backups: u64,
    path: Option<String>,
) -> Result<serde_json::Value, String> {
    state.require_operation("restore_grub_backup").await?;
    let path = path.unwrap_or_else(|| GRUB_CONFIG_PATH.into());
    broker::call_broker(serde_json::json!({ "op": "restore_system_file_backup", "path": path, "filename": filename, "keep_backups": keep_backups })).await
}

/// Default entry and timeout of Limine, systemd-boot or rEFInd. `None`
/// leaves a setting as it is.
#[tauri::command]
async fn set_boot_options(
    state: tauri::State<'_, PermissionRegistry>,
    default_entry: Option<String>,
    timeout: Option<String>,
    keep_backups: u64,
) -> Result<serde_json::Value, String> {
    state.require_operation("set_boot_options").await?;
    broker::call_broker(serde_json::json!({ "op": "set_boot_options", "default_entry": default_entry, "timeout": timeout, "keep_backups": keep_backups })).await
}

#[tauri::command]
async fn read_boot_entries(state: tauri::State<'_, PermissionRegistry>) -> Result<serde_json::Value, String> {
    state.require_operation("read_boot_entries").await?;
    broker::call_broker(serde_json::json!({ "op": "read_boot_entries" })).await
}

/// Removes a native-manager or snap package via the privileged broker.
/// The uninstaller's own `uninstall` always fails for these two sources
/// (needs root); flatpak keeps that unprivileged path since it has its own
/// escalation. The broker re-validates the package id itself regardless.
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
            app.manage(ProfileStore::load(app.path().app_data_dir()?.join("system-profile.json")));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            call_module,
            get_system_profile,
            set_system_profile,
            set_access_level,
            get_access_level,
            remove_bloatware,
            set_services,
            analyze_component_store,
            clean_component_store,
            winget_upgrade,
            delete_local_snapshots,
            health_smart,
            vault_start,
            vault_stop,
            vault_request,
            request_permission,
            full_disk_access,
            open_full_disk_access_settings,
            clean_system_paths,
            uninstall_pkg_privileged,
            vacuum_journal,
            pkg_cache_clean,
            pkg_autoremove,
            snap_remove_revision,
            remove_kernel,
            write_grub_config,
            install_grub_theme,
            restore_grub_backup,
            set_boot_options,
            read_boot_entries
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
