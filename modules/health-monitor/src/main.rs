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
//!   {"cmd":"smart_report","device":"/dev/sda","output":"<smartctl -j>","error":null}
//!
//! S.M.A.R.T. honesty note: raw ATA/NVMe passthrough commands typically
//! need root, so `smart` is expected to often fail with a permission error
//! on an unprivileged install — that's surfaced as a normal per-disk error,
//! not treated as a bug, and there is deliberately no pkexec/sudo shortcut
//! here (same elevation-sequencing rule as every other module: privileged
//! reads go through the permission broker). `extract_smart`'s field parsing
//! is unit tested against synthetic smartctl JSON covering both the ATA and
//! NVMe shapes (see tests below); the parsing is verified, the end-to-end
//! path against real hardware is not.

use std::io::{self, BufRead, Write};
use std::process::Command;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sysinfo::{Disks, Pid, ProcessesToUpdate, Signal, System};

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Snapshot,
    ListDisks,
    Smart { device: String },
    /// smartctl output the broker obtained as root, to be read here.
    SmartReport { device: String, output: String, error: Option<String> },
    Kill { pid: u32 },
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
    /// Sensors, GPUs and anything else the shared crate learns to read.
    /// Optional by construction: a machine without a card contributes
    /// nothing here rather than a row of zeroes.
    metrics: Vec<sysmetrics::Metric>,
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
    // `new_all` would also collect networks, users and components this
    // module never reads — about 225 ms of work per snapshot. Each source
    // below is refreshed explicitly instead.
    let mut sys = System::new();
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
        metrics: sysmetrics::collect(),
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

/// Whole disks — disk0, never its slices like disk0s1. APFS puts its
/// synthesized containers here as well; smartctl answers that those have
/// no SMART, which the view shows as it is. No size: that takes an ioctl.
#[cfg(target_os = "macos")]
fn list_block_devices() -> Vec<BlockDevice> {
    let mut numbers: Vec<u32> = std::fs::read_dir("/dev")
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| e.file_name().to_str()?.strip_prefix("disk")?.parse().ok())
        .collect();
    numbers.sort_unstable();
    numbers.into_iter().map(|n| BlockDevice { device: format!("/dev/disk{n}"), size_bytes: None }).collect()
}

/// Every physical drive Windows numbers, under the name smartctl gives it:
/// \\.\PhysicalDrive0 is /dev/sda. Opening one to ask nothing of it needs
/// no administrator; reading its size would, so there is none.
// shortcut: PhysicalDrive0–25 only (sda–sdz); more drives than that is a server.
#[cfg(windows)]
fn list_block_devices() -> Vec<BlockDevice> {
    use std::os::windows::fs::OpenOptionsExt;
    (0u8..26)
        .filter(|n| std::fs::OpenOptions::new().access_mode(0).open(format!(r"\\.\PhysicalDrive{n}")).is_ok())
        .map(|n| BlockDevice { device: format!("/dev/sd{}", char::from(b'a' + n)), size_bytes: None })
        .collect()
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn list_block_devices() -> Vec<BlockDevice> {
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

/// Display-only suggestion — never executed by this app. Names the
/// command for this system's own package manager; falls back to naming the
/// package alone where that manager is not one POSMA drives.
fn install_hint() -> String {
    if cfg!(target_os = "linux") {
        match distro::manager() {
            Ok(manager) => manager.install_hint("smartmontools"),
            Err(_) => "smartmontools (menedżer pakietów systemu)".into(),
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

    let smartctl = distro::find_program("smartctl").unwrap_or_else(|| "smartctl".into());
    let output = match Command::new(smartctl).args(["-a", "-j", &device]).output() {
        Ok(o) => o,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return missing_smartctl(device),
        Err(e) => {
            info.error = Some(e.to_string());
            return info;
        }
    };
    interpret_smart(device, &String::from_utf8_lossy(&output.stdout), &String::from_utf8_lossy(&output.stderr))
}

fn missing_smartctl(device: String) -> SmartInfo {
    SmartInfo {
        device,
        error: Some("smartctl nie jest zainstalowany w systemie".into()),
        missing_tool: Some("smartctl (pakiet smartmontools)".into()),
        install_hint: Some(install_hint()),
        ..Default::default()
    }
}

/// What smartctl answered when the broker ran it as root. Its exit status
/// is a bit mask that is non-zero for a disk reporting errors as well, so
/// the text decides here, not the broker's success flag — a failing disk
/// is the one answer that must not turn into "could not read".
fn smart_report(device: String, output: String, error: Option<String>) -> SmartInfo {
    let error = error.unwrap_or_default();
    // How the broker reports a program that is not there at all.
    if output.trim().is_empty() && error.contains("(os error 2)") {
        return missing_smartctl(device);
    }
    interpret_smart(device, &output, &error)
}

/// smartctl's `-j` output turned into this module's answer, wherever it
/// was run.
fn interpret_smart(device: String, stdout: &str, stderr: &str) -> SmartInfo {
    let mut info = SmartInfo { device, ..Default::default() };
    let Ok(json) = serde_json::from_str::<Value>(stdout) else {
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

#[derive(Serialize)]
struct KillResult {
    success: bool,
    message: String,
}

/// Asks a process to stop.
///
/// Sends SIGTERM rather than SIGKILL: the point is to end something that has
/// run away, not to deny it the chance to close its files. A process the
/// user does not own refuses at the kernel, which is reported as it comes
/// back rather than escalated — killing another user's process is not
/// something this module should be able to arrange.
fn kill(pid: u32) -> KillResult {
    if pid <= 1 {
        return KillResult {
            success: false,
            message: "Odmowa: to proces init systemu".into(),
        };
    }
    if pid == std::process::id() {
        return KillResult {
            success: false,
            message: "Odmowa: to sam moduł monitora".into(),
        };
    }

    let mut sys = System::new();
    let target = Pid::from_u32(pid);
    sys.refresh_processes(ProcessesToUpdate::Some(&[target]), true);

    let Some(process) = sys.process(target) else {
        return KillResult { success: false, message: format!("Nie ma procesu {pid}") };
    };
    let name = process.name().to_string_lossy().into_owned();

    // Windows has no SIGTERM to ask with: ending a process there is
    // TerminateProcess, the only signal sysinfo offers on it.
    let (signal, sent) = if cfg!(windows) { (Signal::Kill, "Zakończono") } else { (Signal::Term, "Wysłano SIGTERM do") };
    match process.kill_with(signal) {
        Some(true) => KillResult { success: true, message: format!("{sent} {name} ({pid})") },
        Some(false) => KillResult {
            success: false,
            message: format!("{name} ({pid}): odmowa — proces należy do innego użytkownika"),
        },
        None => KillResult {
            success: false,
            message: "Ten system nie obsługuje SIGTERM".into(),
        },
    }
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
            Ok(Request::SmartReport { device, output, error }) => serde_json::to_string(&ok(smart_report(device, output, error))),
            Ok(Request::Kill { pid }) => serde_json::to_string(&ok(kill(pid))),
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

    /// The broker reports smartctl's non-zero exit for a failing disk as a
    /// failed command; the disk's verdict must still come through.
    #[test]
    fn a_failing_disk_reported_by_the_broker_reads_as_failing() {
        let output = r#"{"model_name":"WDC WD10EZEX","smart_status":{"passed":false},"temperature":{"current":51}}"#;
        let info = smart_report("/dev/sda".into(), output.into(), Some("polecenie zakończyło się błędem".into()));
        assert!(info.available);
        assert_eq!(info.passed, Some(false));
        assert_eq!(info.temperature_c, Some(51));

        let missing = smart_report("/dev/sda".into(), String::new(), Some("No such file or directory (os error 2)".into()));
        assert!(!missing.available);
        assert!(missing.missing_tool.is_some() && missing.install_hint.is_some());

        let refused = smart_report("/dev/sda".into(), String::new(), Some("smart_read: operacja nieobsługiwana".into()));
        assert_eq!(refused.error.as_deref(), Some("smart_read: operacja nieobsługiwana"));
        assert!(refused.missing_tool.is_none());
    }

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
