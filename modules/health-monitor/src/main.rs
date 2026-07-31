//! health-monitor sidecar: point-in-time CPU/RAM/process/disk snapshot
//! (the frontend polls this repeatedly for a "live" view — there is no
//! streaming/long-lived process here, same one-shot protocol as every other
//! sidecar), plus best-effort S.M.A.R.T. disk health via the system's
//! `smartctl` binary when it's installed and accessible.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"snapshot"}
//!   {"cmd":"list_disks"}
//!   {"cmd":"smart","device":"/dev/sda"}
//!
//! S.M.A.R.T. honesty note: raw ATA/NVMe passthrough commands typically
//! need root, so `smart` is expected to often fail with a permission error
//! on an unprivileged install — that's surfaced as a normal per-disk error,
//! not treated as a bug, and there is deliberately no pkexec/sudo shortcut
//! here (same elevation-sequencing rule as every other module: wait for the
//! planned permission broker). `extract_smart`'s field parsing is unit
//! tested against hand-built synthetic smartctl JSON (see tests below) since
//! this dev machine has no smartctl installed to verify against real
//! hardware — that path is unverified until tested on a real disk.

use std::io::{self, BufRead, Write};
use std::process::Command;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sysinfo::{Disks, ProcessesToUpdate, System};

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Snapshot,
    ListDisks,
    Smart { device: String },
}

#[derive(Serialize)]
struct ProcessInfo {
    pid: u32,
    name: String,
    cpu_percent: f32,
    mem_bytes: u64,
}

#[derive(Serialize)]
struct DiskInfo {
    name: String,
    mount_point: String,
    total_bytes: u64,
    available_bytes: u64,
}

#[derive(Serialize)]
struct Snapshot {
    cpu_percent: f32,
    cores: Vec<f32>,
    ram_used_bytes: u64,
    ram_total_bytes: u64,
    swap_used_bytes: u64,
    swap_total_bytes: u64,
    uptime_secs: u64,
    top_processes: Vec<ProcessInfo>,
    disks: Vec<DiskInfo>,
}

#[derive(Serialize)]
struct BlockDevice {
    device: String,
    size_bytes: Option<u64>,
}

#[derive(Serialize, Default)]
struct SmartInfo {
    device: String,
    available: bool,
    model: Option<String>,
    passed: Option<bool>,
    temperature_c: Option<i64>,
    power_on_hours: Option<u64>,
    error: Option<String>,
    /// Only set when `error` means "smartctl isn't installed" — a
    /// human-readable install command for whichever package manager this
    /// system appears to have. Display-only: this app does not run it.
    /// Actually installing needs root, same as running smartctl itself for
    /// real ATA/NVMe passthrough — both wait for the Access_plan.md broker.
    missing_tool: Option<String>,
    install_hint: Option<String>,
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

fn snapshot() -> Snapshot {
    let mut sys = System::new_all();
    sys.refresh_cpu_usage();
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let cores: Vec<f32> = sys.cpus().iter().map(|c| c.cpu_usage()).collect();

    let mut processes: Vec<ProcessInfo> = sys
        .processes()
        .values()
        .map(|p| ProcessInfo {
            pid: p.pid().as_u32(),
            name: p.name().to_string_lossy().into_owned(),
            cpu_percent: p.cpu_usage(),
            mem_bytes: p.memory(),
        })
        .collect();
    processes.sort_by(|a, b| b.cpu_percent.partial_cmp(&a.cpu_percent).unwrap_or(std::cmp::Ordering::Equal));
    processes.truncate(8);

    let disks: Vec<DiskInfo> = Disks::new_with_refreshed_list()
        .iter()
        .map(|d| DiskInfo {
            name: d.name().to_string_lossy().into_owned(),
            mount_point: d.mount_point().to_string_lossy().into_owned(),
            total_bytes: d.total_space(),
            available_bytes: d.available_space(),
        })
        .collect();

    Snapshot {
        cpu_percent: sys.global_cpu_usage(),
        cores,
        ram_used_bytes: sys.used_memory(),
        ram_total_bytes: sys.total_memory(),
        swap_used_bytes: sys.used_swap(),
        swap_total_bytes: sys.total_swap(),
        uptime_secs: System::uptime(),
        top_processes: processes,
        disks,
    }
}

#[cfg(target_os = "linux")]
fn list_block_devices() -> Vec<BlockDevice> {
    let mut out = Vec::new();
    if let Ok(read) = std::fs::read_dir("/sys/block") {
        for entry in read.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("loop") || name.starts_with("sr") || name.starts_with("ram") {
                continue;
            }
            let size_bytes = std::fs::read_to_string(entry.path().join("size"))
                .ok()
                .and_then(|s| s.trim().parse::<u64>().ok())
                .map(|sectors| sectors * 512);
            out.push(BlockDevice { device: format!("/dev/{name}"), size_bytes });
        }
    }
    out.sort_by(|a, b| a.device.cmp(&b.device));
    out
}

#[cfg(not(target_os = "linux"))]
fn list_block_devices() -> Vec<BlockDevice> {
    // Windows/macOS device enumeration is unimplemented — untested territory,
    // same as this app's other OS-specific paths. Returns empty rather than guessing.
    Vec::new()
}

fn get_path<'a>(v: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut cur = v;
    for key in path {
        cur = cur.get(key)?;
    }
    Some(cur)
}

/// Reads a handful of well-known smartctl `-j` JSON fields, trying both the
/// ATA and NVMe shapes since the schema differs by drive type. Missing
/// fields just stay None — this never panics on an unexpected shape.
fn extract_smart(v: &Value, info: &mut SmartInfo) {
    info.model = get_path(v, &["model_name"])
        .and_then(|x| x.as_str())
        .map(String::from)
        .or_else(|| get_path(v, &["device", "model_name"]).and_then(|x| x.as_str()).map(String::from));
    info.passed = get_path(v, &["smart_status", "passed"]).and_then(|x| x.as_bool());
    info.temperature_c = get_path(v, &["temperature", "current"])
        .and_then(|x| x.as_i64())
        .or_else(|| get_path(v, &["nvme_smart_health_information_log", "temperature"]).and_then(|x| x.as_i64()));
    info.power_on_hours = get_path(v, &["power_on_time", "hours"])
        .and_then(|x| x.as_u64())
        .or_else(|| get_path(v, &["nvme_smart_health_information_log", "power_on_hours"]).and_then(|x| x.as_u64()));
}

/// Display-only suggestion — never executed by this app. Picks a command
/// based on whichever package manager binary is present; falls back to
/// naming the package alone when none of the checked ones are found.
fn install_hint() -> String {
    if cfg!(target_os = "linux") {
        if std::path::Path::new("/usr/bin/apt").exists() {
            "sudo apt install smartmontools".into()
        } else if std::path::Path::new("/usr/bin/dnf").exists() {
            "sudo dnf install smartmontools".into()
        } else if std::path::Path::new("/usr/bin/pacman").exists() {
            "sudo pacman -S smartmontools".into()
        } else {
            "smartmontools (menedżer pakietów systemu)".into()
        }
    } else if cfg!(target_os = "macos") {
        "brew install smartmontools".into()
    } else if cfg!(target_os = "windows") {
        "winget install --id smartmontools.smartmontools".into()
    } else {
        "smartmontools".into()
    }
}

fn smart(device: String) -> SmartInfo {
    let mut info = SmartInfo { device: device.clone(), ..Default::default() };

    // Only real /dev nodes with plain names — anything else (and
    // specifically anything starting with `-`) could be read by smartctl
    // as a flag rather than a device path.
    let valid_device = device.starts_with("/dev/")
        && device["/dev/".len()..].chars().all(|c| c.is_ascii_alphanumeric() || c == '/');
    if !valid_device {
        info.error = Some(format!("{device}: nieprawidłowa nazwa urządzenia"));
        return info;
    }

    let output = match Command::new("smartctl").args(["-a", "-j", &device]).output() {
        Ok(o) => o,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            info.error = Some("smartctl nie jest zainstalowany w systemie".into());
            info.missing_tool = Some("smartctl (pakiet smartmontools)".into());
            info.install_hint = Some(install_hint());
            return info;
        }
        Err(e) => {
            info.error = Some(e.to_string());
            return info;
        }
    };

    let Ok(json) = serde_json::from_slice::<Value>(&output.stdout) else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        info.error = Some(if stderr.trim().is_empty() { "brak odpowiedzi smartctl".into() } else { stderr.trim().to_string() });
        return info;
    };

    extract_smart(&json, &mut info);

    if info.passed.is_none() && info.temperature_c.is_none() && info.model.is_none() {
        let message = get_path(&json, &["smartctl", "messages"])
            .and_then(|m| m.as_array())
            .and_then(|a| a.first())
            .and_then(|m| m.get("string"))
            .and_then(|s| s.as_str());
        info.error = Some(message.map(String::from).unwrap_or_else(|| {
            "nie udało się odczytać danych SMART (mogą być wymagane uprawnienia administratora)".into()
        }));
        return info;
    }

    info.available = true;
    info
}

fn main() {
    let mut line = String::new();
    let output = match io::stdin().lock().read_line(&mut line) {
        Ok(0) => serde_json::to_string(&Response::<()>::Err {
            ok: false,
            error: "no command received on stdin".into(),
        }),
        Ok(_) => match serde_json::from_str::<Request>(line.trim()) {
            Ok(Request::Snapshot) => serde_json::to_string(&ok(snapshot())),
            Ok(Request::ListDisks) => serde_json::to_string(&ok(list_block_devices())),
            Ok(Request::Smart { device }) => serde_json::to_string(&ok(smart(device))),
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
    use super::*;

    #[test]
    fn extracts_nvme_shape() {
        let json: Value = serde_json::from_str(
            r#"{
                "model_name": "Samsung SSD 980 PRO 1TB",
                "smart_status": { "passed": true },
                "nvme_smart_health_information_log": { "temperature": 42, "power_on_hours": 3120 }
            }"#,
        )
        .unwrap();
        let mut info = SmartInfo { device: "/dev/nvme0n1".into(), ..Default::default() };
        extract_smart(&json, &mut info);
        assert_eq!(info.model.as_deref(), Some("Samsung SSD 980 PRO 1TB"));
        assert_eq!(info.passed, Some(true));
        assert_eq!(info.temperature_c, Some(42));
        assert_eq!(info.power_on_hours, Some(3120));
    }

    #[test]
    fn extracts_ata_shape() {
        let json: Value = serde_json::from_str(
            r#"{
                "model_name": "WDC WD10EZEX-08WN4A0",
                "smart_status": { "passed": true },
                "temperature": { "current": 35 },
                "power_on_time": { "hours": 9001 }
            }"#,
        )
        .unwrap();
        let mut info = SmartInfo { device: "/dev/sda".into(), ..Default::default() };
        extract_smart(&json, &mut info);
        assert_eq!(info.model.as_deref(), Some("WDC WD10EZEX-08WN4A0"));
        assert_eq!(info.passed, Some(true));
        assert_eq!(info.temperature_c, Some(35));
        assert_eq!(info.power_on_hours, Some(9001));
    }

    #[test]
    fn handles_empty_json_without_panicking() {
        let json: Value = serde_json::from_str("{}").unwrap();
        let mut info = SmartInfo { device: "/dev/sdz".into(), ..Default::default() };
        extract_smart(&json, &mut info);
        assert!(info.model.is_none());
        assert!(info.passed.is_none());
        assert!(info.temperature_c.is_none());
        assert!(info.power_on_hours.is_none());
    }
}
