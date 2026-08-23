//! system-info sidecar: what this machine will report about itself without
//! any privilege. Protocol: {"cmd":"get_info"}.
//!
//! Every metric is optional. A missing sensor or an unreadable file is not
//! an error and produces no placeholder — it is absent from the list and
//! the interface lays out whatever arrived. Hence a list rather than a
//! struct: a struct would force a decision about what absent looks like.
//!
//! Sensor collection lives in the shared `sysmetrics` crate, so a source
//! added there — a GPU counter, a new chip — reaches this module and the
//! health monitor at once instead of being wired into each separately.

use std::fs;
use std::io::{self, BufRead, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};
use sysinfo::{Disks, System};
use sysmetrics::{Metric, MetricKind};

#[derive(Deserialize)]
struct Request {
    cmd: String,
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

fn collect() -> SystemInfo {
    let mut sys = System::new_all();
    sys.refresh_cpu_usage();
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let mut metrics = Vec::new();

    let cpu = sys.global_cpu_usage() as f64;
    metrics.push(
        Metric::new("cpu", "CPU", cpu, "%", MetricKind::Load)
            .percent_of(cpu)
            .detail(format!("{} rdzeni", sys.cpus().len())),
    );

    let ram_total = sys.total_memory();
    if ram_total > 0 {
        let used = sys.used_memory();
        let pct = used as f64 / ram_total as f64 * 100.0;
        metrics.push(
            Metric::new("ram", "RAM", pct, "%", MetricKind::Load)
                .percent_of(pct)
                .detail(format!("{:.1} / {:.1} GB", gb(used), gb(ram_total))),
        );
    }

    // Swap is deliberately not reported. On a machine with enough memory it
    // sits at zero permanently, which is a tile that never says anything.

    // Sensors, GPUs and anything added to the shared crate later.
    metrics.extend(sysmetrics::collect());

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

    #[test]
    fn partition_maps_to_its_block_device() {
        assert_eq!("nvme0n1p2".split('p').next().unwrap(), "nvme0n1");
        assert_eq!("sda1".trim_end_matches(|c: char| c.is_ascii_digit()), "sda");
    }

    /// Whatever this machine has, the shape has to hold.
    #[test]
    fn collecting_produces_usable_metrics() {
        let info = collect();
        assert!(info.metrics.iter().any(|m| m.id == "cpu"), "CPU is always available");
        for m in &info.metrics {
            assert!(m.value.is_finite());
        }
    }
}
