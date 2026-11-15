//! system-info sidecar: what this machine will report about itself without
//! any privilege. Protocol: {"cmd":"get_info"} | {"cmd":"profile"}.
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
    /// Load of each logical core, in percent, in the order the kernel numbers them.
    cores: Vec<f32>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Response {
    Ok { ok: bool, data: SystemInfo },
    Profile { ok: bool, data: serde_json::Value },
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

/// One row per filesystem rather than per mount point.
///
/// btrfs subvolumes — the default layout on CachyOS, Fedora and openSUSE —
/// mount one device at `/`, `/home`, `/var/log` and several more, every one
/// reporting the same free space. Listed as they come, a single full disk
/// reads as seven. The shortest mount point is kept: it is the one a
/// person would name.
///
/// Only device paths are collapsed. Elsewhere the name is a volume label,
/// and two drives may well share one.
fn one_per_filesystem(mut disks: Vec<DiskInfo>) -> Vec<DiskInfo> {
    disks.sort_by_key(|d| d.mount_point.len());
    let mut seen = std::collections::HashSet::new();
    disks.retain(|d| !d.name.starts_with("/dev/") || seen.insert(d.name.clone()));
    disks
}

fn collect() -> SystemInfo {
    // Deliberately not `new_all`: that collects processes, networks and
    // users as well, costs about 225 ms, and this module reads none of it.
    // Asking for the two things it does need costs about two.
    let mut sys = System::new();
    sys.refresh_cpu_usage();
    // sysinfo needs two samples to report a rate; the wait between them is
    // idle, not work.
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let mut metrics = Vec::new();

    // Already sampled for the global figure, so the per-core split costs nothing.
    let cores = sys.cpus().iter().map(|c| c.cpu_usage()).collect();

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
                // Polish decimals: the dashboard shows this string as it is.
                .detail(format!("{:.1} z {:.1} GB", gb(used), gb(ram_total)).replace('.', ",")),
        );
    }

    // Swap is deliberately not reported. On a machine with enough memory it
    // sits at zero permanently, which is a tile that never says anything.

    // Sensors, GPUs and anything added to the shared crate later.
    metrics.extend(sysmetrics::collect());

    let disks: Vec<DiskInfo> = Disks::new_with_refreshed_list()
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

    SystemInfo { metrics, disks: one_per_filesystem(disks), cores }
}

/// What kind of Linux this is, for the interface to show and the user to
/// correct: each value as it stands — the user's correction, which the core
/// passes in the environment, applied — beside what detection alone found.
fn linux_profile() -> serde_json::Value {
    let os_release = distro::os_release();
    let value = |key| distro::os_release_value(&os_release, key);
    let id = |m: distro::Manager| m.id();
    serde_json::json!({
        "name": value("PRETTY_NAME").or_else(|| value("NAME")).unwrap_or_else(|| "Linux".into()),
        "id": value("ID"),
        "like": value("ID_LIKE").map(|v| v.split_whitespace().map(String::from).collect::<Vec<_>>()).unwrap_or_default(),
        "family": distro::manager().ok().map(id),
        "family_detected": distro::manager_preferring(None).ok().map(id),
        "family_declared": distro::declared_family().is_some(),
        "family_unavailable": distro::manager().err(),
        "managers": distro::installed_managers().into_iter().map(id).collect::<Vec<_>>(),
        "immutable": distro::is_immutable(),
        "desktop": distro::desktop(),
        "desktop_detected": distro::desktop_detected(),
        "bootloader": distro::bootloader(),
        "bootloader_detected": distro::bootloader_detected(),
        "systemd": distro::systemd_booted(),
    })
}

fn main() {
    let mut line = String::new();
    let response = match io::stdin().lock().read_line(&mut line) {
        Ok(0) => Response::Err { ok: false, error: "no command received on stdin".into() },
        Ok(_) => match serde_json::from_str::<Request>(line.trim()) {
            Ok(req) if req.cmd == "get_info" => Response::Ok { ok: true, data: collect() },
            Ok(req) if req.cmd == "profile" => Response::Profile { ok: true, data: linux_profile() },
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

    fn disk(name: &str, mount_point: &str) -> DiskInfo {
        DiskInfo { name: name.into(), mount_point: mount_point.into(), total_bytes: 1, available_bytes: 1, model: None, solid_state: None }
    }

    /// The layout a default CachyOS install has, plus a second drive.
    #[test]
    fn subvolumes_of_one_device_are_one_disk() {
        let mounts = [
            ("/dev/nvme0n1p2", "/home"),
            ("/dev/nvme0n1p2", "/var/log"),
            ("/dev/nvme0n1p2", "/"),
            ("/dev/nvme0n1p1", "/boot"),
            ("/dev/sda1", "/mnt/dane"),
        ];
        let kept = one_per_filesystem(mounts.iter().map(|(n, m)| disk(n, m)).collect());
        let points: Vec<&str> = kept.iter().map(|d| d.mount_point.as_str()).collect();
        assert_eq!(points, ["/", "/boot", "/mnt/dane"]);
    }

    /// A volume label is not an identity: two drives called "Dane" stay two.
    #[test]
    fn same_label_is_not_same_filesystem() {
        let kept = one_per_filesystem(vec![disk("Dane", "D:\\"), disk("Dane", "E:\\")]);
        assert_eq!(kept.len(), 2);
    }

    /// Whatever this machine has, the shape has to hold.
    #[test]
    fn collecting_produces_usable_metrics() {
        let info = collect();
        assert!(info.metrics.iter().any(|m| m.id == "cpu"), "CPU is always available");
        for m in &info.metrics {
            assert!(m.value.is_finite());
        }
        assert!(!info.cores.is_empty(), "every machine has at least one core");
        assert!(info.cores.iter().all(|c| c.is_finite() && *c >= 0.0));
    }
}
