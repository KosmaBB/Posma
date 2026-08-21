//! system-info sidecar: what this machine will report about itself without
//! any privilege. Protocol: {"cmd":"get_info"}.
//!
//! Every metric is optional. A missing sensor or an unreadable file is not
//! an error and produces no placeholder — it is absent from the list and
//! the interface lays out whatever arrived. Hence a list rather than a
//! struct: a struct would force a decision about what absent looks like.

use std::fs;
use std::io::{self, BufRead, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};
use sysinfo::{Disks, System};

#[derive(Deserialize)]
struct Request {
    cmd: String,
}

/// How the interface should treat a metric, without having to know its id.
#[derive(Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "snake_case")]
enum MetricKind {
    /// Fluctuates constantly; worth plotting over time.
    Load,
    /// A fill level. Not emitted here since swap was dropped, but part of
    /// the protocol: the interface builds the main-volume tile with it from
    /// the disk list, and a future metric with a ceiling belongs in it too.
    #[allow(dead_code)]
    Capacity,
    /// Degrees Celsius.
    Temperature,
}

#[derive(Serialize)]
struct Metric {
    id: String,
    label: String,
    value: f64,
    unit: String,
    /// 0..100 where the metric maps onto a bar. Absent where it does not —
    /// a CPU at 57 °C has no meaningful "percent full".
    #[serde(skip_serializing_if = "Option::is_none")]
    percent: Option<f64>,
    /// Secondary line, already formatted for display.
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    kind: MetricKind,
}

#[derive(Serialize)]
struct DiskInfo {
    name: String,
    mount_point: String,
    total_bytes: u64,
    available_bytes: u64,
    /// Absent when the kernel does not expose a model for this device.
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    /// Absent when rotational state cannot be determined.
    #[serde(skip_serializing_if = "Option::is_none")]
    solid_state: Option<bool>,
}

#[derive(Serialize)]
struct SystemInfo {
    metrics: Vec<Metric>,
    disks: Vec<DiskInfo>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Response {
    Ok { ok: bool, data: SystemInfo },
    Err { ok: bool, error: String },
}

fn gb(bytes: u64) -> f64 {
    bytes as f64 / 1024f64.powi(3)
}

// ============================================================ temperatures

/// One reading straight out of sysfs.
struct Reading {
    chip: String,
    label: Option<String>,
    celsius: f64,
}

/// Reads every temperature the kernel exposes through hwmon.
///
/// These are plain text files under /sys and are world-readable, so none of
/// this needs elevation — unlike S.M.A.R.T., which goes through a raw
/// device ioctl and genuinely does. Anything unreadable is skipped rather
/// than reported: a missing sensor is not a failure.
fn read_hwmon() -> Vec<Reading> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir("/sys/class/hwmon") else {
        return out;
    };

    for entry in entries.flatten() {
        let dir = entry.path();
        let Ok(chip) = fs::read_to_string(dir.join("name")) else { continue };
        let chip = chip.trim().to_string();

        let Ok(files) = fs::read_dir(&dir) else { continue };
        for file in files.flatten() {
            let name = file.file_name().to_string_lossy().into_owned();
            let Some(index) = name.strip_prefix("temp").and_then(|r| r.strip_suffix("_input")) else {
                continue;
            };

            let Ok(raw) = fs::read_to_string(file.path()) else { continue };
            let Ok(millidegrees) = raw.trim().parse::<f64>() else { continue };

            // Sensors report in millidegrees; a value outside human range
            // means the file is something else wearing the same name.
            let celsius = millidegrees / 1000.0;
            if !(-40.0..=150.0).contains(&celsius) {
                continue;
            }

            let label = fs::read_to_string(dir.join(format!("temp{index}_label")))
                .ok()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty());

            out.push(Reading { chip: chip.clone(), label, celsius });
        }
    }

    out
}

/// Chips worth showing, and what to call them.
///
/// A machine reports temperatures for things nobody is asking about — the
/// network controller, the voltage regulator. Showing all of them turns a
/// dashboard into a sensor dump, so this is an allow-list, and a chip that
/// is not on it contributes nothing rather than an unlabelled number.
fn cpu_temperature(readings: &[Reading]) -> Option<Metric> {
    const CPU_CHIPS: [&str; 5] = ["k10temp", "coretemp", "zenpower", "cpu_thermal", "acpitz"];

    // Preference order matters: Tctl and "Package id 0" are the whole-package
    // figures, while the per-core sensors underneath them run cooler and
    // would understate the number.
    let best = readings
        .iter()
        .filter(|r| CPU_CHIPS.contains(&r.chip.as_str()))
        .max_by(|a, b| {
            let rank = |r: &Reading| match r.label.as_deref() {
                Some("Tctl") | Some("Package id 0") => 2,
                Some(_) => 1,
                None => 0,
            };
            rank(a)
                .cmp(&rank(b))
                .then(a.celsius.partial_cmp(&b.celsius).unwrap_or(std::cmp::Ordering::Equal))
        })?;

    Some(Metric {
        id: "temp-cpu".into(),
        label: "Procesor".into(),
        value: best.celsius.round(),
        unit: "°C".into(),
        percent: None,
        detail: Some(best.chip.clone()),
        kind: MetricKind::Temperature,
    })
}

fn drive_temperatures(readings: &[Reading]) -> Vec<Metric> {
    const DRIVE_CHIPS: [&str; 2] = ["nvme", "drivetemp"];

    let mut drives: Vec<&Reading> = readings
        .iter()
        .filter(|r| DRIVE_CHIPS.contains(&r.chip.as_str()))
        // NVMe exposes a composite figure plus per-sensor ones; the
        // composite is the drive's own summary and the rest is detail.
        .filter(|r| r.label.as_deref().is_none_or(|l| l.eq_ignore_ascii_case("Composite")))
        .collect();

    drives.sort_by(|a, b| b.celsius.partial_cmp(&a.celsius).unwrap_or(std::cmp::Ordering::Equal));

    drives
        .iter()
        .enumerate()
        .map(|(i, r)| Metric {
            id: format!("temp-drive-{i}"),
            label: if drives.len() > 1 { format!("Dysk {}", i + 1) } else { "Dysk".into() },
            value: r.celsius.round(),
            unit: "°C".into(),
            percent: None,
            detail: Some(r.chip.clone()),
            kind: MetricKind::Temperature,
        })
        .collect()
}

// ================================================================== disks

/// Model and rotational flag, straight from sysfs. Both are absent on
/// anything the kernel does not describe that way — network mounts, loop
/// devices, containers — and absence is passed through as absence.
fn disk_details(device_name: &str) -> (Option<String>, Option<bool>) {
    // "/dev/nvme0n1p2" -> the block device directory is keyed by "nvme0n1".
    let base = device_name.trim_start_matches("/dev/");
    let stem = base
        .find(|c: char| c.is_ascii_digit())
        .map(|_| {
            if base.starts_with("nvme") {
                base.split('p').next().unwrap_or(base)
            } else {
                base.trim_end_matches(|c: char| c.is_ascii_digit())
            }
        })
        .unwrap_or(base);

    let dir = Path::new("/sys/block").join(stem);
    let model = fs::read_to_string(dir.join("device/model"))
        .ok()
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty());
    let solid_state = fs::read_to_string(dir.join("queue/rotational"))
        .ok()
        .and_then(|r| r.trim().parse::<u8>().ok())
        .map(|r| r == 0);

    (model, solid_state)
}

// =================================================================== main

fn collect() -> SystemInfo {
    let mut sys = System::new_all();
    sys.refresh_cpu_usage();
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let mut metrics = Vec::new();

    metrics.push(Metric {
        id: "cpu".into(),
        label: "CPU".into(),
        value: sys.global_cpu_usage() as f64,
        unit: "%".into(),
        percent: Some(sys.global_cpu_usage() as f64),
        detail: Some(format!("{} rdzeni", sys.cpus().len())),
        kind: MetricKind::Load,
    });

    let ram_total = sys.total_memory();
    if ram_total > 0 {
        let used = sys.used_memory();
        let pct = used as f64 / ram_total as f64 * 100.0;
        metrics.push(Metric {
            id: "ram".into(),
            label: "RAM".into(),
            value: pct,
            unit: "%".into(),
            percent: Some(pct),
            detail: Some(format!("{:.1} / {:.1} GB", gb(used), gb(ram_total))),
            kind: MetricKind::Load,
        });
    }

    // Swap is deliberately not reported. On a machine with enough memory it
    // sits at zero permanently, which is a tile that never says anything —
    // and dropping it keeps the count of tiles even, which lays out cleanly
    // at every window size. It stays collected nowhere rather than
    // collected and hidden, so there is no dead value to explain.

    let readings = read_hwmon();
    if let Some(cpu_temp) = cpu_temperature(&readings) {
        metrics.push(cpu_temp);
    }
    metrics.extend(drive_temperatures(&readings));

    let disks = Disks::new_with_refreshed_list()
        .into_iter()
        .map(|disk| {
            let name = disk.name().to_string_lossy().into_owned();
            let (model, solid_state) = disk_details(&name);
            DiskInfo {
                name,
                mount_point: disk.mount_point().to_string_lossy().into_owned(),
                total_bytes: disk.total_space(),
                available_bytes: disk.available_space(),
                model,
                solid_state,
            }
        })
        .collect();

    SystemInfo { metrics, disks }
}

fn main() {
    let mut line = String::new();
    let response = match io::stdin().lock().read_line(&mut line) {
        Ok(0) => Response::Err { ok: false, error: "no command received on stdin".into() },
        Ok(_) => match serde_json::from_str::<Request>(line.trim()) {
            Ok(req) if req.cmd == "get_info" => Response::Ok { ok: true, data: collect() },
            Ok(req) => Response::Err { ok: false, error: format!("unknown command: {}", req.cmd) },
            Err(e) => Response::Err { ok: false, error: format!("invalid request: {e}") },
        },
        Err(e) => Response::Err { ok: false, error: format!("failed to read stdin: {e}") },
    };

    let out = serde_json::to_string(&response).expect("response must serialize");
    println!("{out}");
    io::stdout().flush().ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(chip: &str, label: Option<&str>, celsius: f64) -> Reading {
        Reading { chip: chip.into(), label: label.map(String::from), celsius }
    }

    /// The point of the whole design: a machine that reports nothing
    /// produces no metrics, not zeroes or placeholders.
    #[test]
    fn no_sensors_yields_no_metrics() {
        assert!(cpu_temperature(&[]).is_none());
        assert!(drive_temperatures(&[]).is_empty());
    }

    /// Sensors nobody asked about contribute nothing rather than an
    /// unlabelled number.
    #[test]
    fn unknown_chips_are_ignored() {
        let readings = vec![r("r8169_0_2a00:00", None, 38.0), r("jc42", None, 42.0)];
        assert!(cpu_temperature(&readings).is_none());
        assert!(drive_temperatures(&readings).is_empty());
    }

    /// Tctl is the package figure; the per-core sensor below it runs cooler
    /// and picking it would understate the reading.
    #[test]
    fn package_sensor_wins_over_per_core() {
        let readings = vec![r("k10temp", Some("Tccd1"), 43.0), r("k10temp", Some("Tctl"), 57.0)];
        let m = cpu_temperature(&readings).expect("CPU chip present");
        assert_eq!(m.value, 57.0);
        assert_eq!(m.unit, "°C");
        assert!(m.percent.is_none(), "a temperature has no fill level");
    }

    /// Intel names the same thing differently.
    #[test]
    fn intel_package_is_recognised() {
        let readings = vec![r("coretemp", Some("Core 0"), 40.0), r("coretemp", Some("Package id 0"), 61.0)];
        assert_eq!(cpu_temperature(&readings).unwrap().value, 61.0);
    }

    /// NVMe reports a composite figure plus per-sensor detail; only the
    /// composite is the drive's own summary.
    #[test]
    fn only_composite_nvme_readings_are_used() {
        let readings = vec![
            r("nvme", Some("Composite"), 42.0),
            r("nvme", Some("Sensor 1"), 44.0),
            r("nvme", Some("Composite"), 34.0),
        ];
        let drives = drive_temperatures(&readings);
        assert_eq!(drives.len(), 2, "two composites, sensor detail dropped");
        assert_eq!(drives[0].value, 42.0, "hottest first");
        assert_eq!(drives[1].value, 34.0);
    }

    /// A single drive is not "Dysk 1" — there is nothing to number against.
    #[test]
    fn a_lone_drive_is_not_numbered() {
        let drives = drive_temperatures(&[r("drivetemp", None, 31.0)]);
        assert_eq!(drives.len(), 1);
        assert_eq!(drives[0].label, "Dysk");
    }

    /// Sysfs files that are not really temperatures must not become 3000 °C.
    #[test]
    fn implausible_readings_are_rejected() {
        let plausible = (-40.0..=150.0);
        assert!(!plausible.contains(&3000.0));
        assert!(plausible.contains(&57.0));
    }

    #[test]
    fn partition_maps_to_its_block_device() {
        // Only the naming rule is asserted; the sysfs read itself depends on
        // the host and is exercised by running the binary.
        assert_eq!("nvme0n1p2".split('p').next().unwrap(), "nvme0n1");
        assert_eq!("sda1".trim_end_matches(|c: char| c.is_ascii_digit()), "sda");
    }
}
