//! Graphics cards, from whichever source the machine actually has.
//!
//! Three routes, tried in order, because no single one covers the field:
//!
//! * **sysfs** — AMD's open driver publishes load and memory under
//!   `/sys/class/drm/card*/device`. Free to read, no process to spawn.
//! * **nvidia-smi** — NVIDIA's proprietary driver exposes no hwmon or sysfs
//!   counters, so its own tool is the only unprivileged route. Costs a
//!   process spawn (~25 ms), which is why it is asked last.
//! * **nothing** — an integrated-only machine reports no card, and that is
//!   an answer rather than a failure.

use std::fs;
use std::path::Path;
use std::process::Command;

use crate::{Metric, MetricKind};

pub fn metrics() -> Vec<Metric> {
    let amd = amd_sysfs();
    if !amd.is_empty() {
        return amd;
    }
    nvidia_smi()
}

fn read_u64(path: &Path) -> Option<u64> {
    fs::read_to_string(path).ok()?.trim().parse().ok()
}

/// AMD's driver, straight from sysfs.
fn amd_sysfs() -> Vec<Metric> {
    let mut out = Vec::new();
    let Ok(cards) = fs::read_dir("/sys/class/drm") else { return out };

    let mut index = 0;
    for card in cards.flatten() {
        let name = card.file_name().to_string_lossy().into_owned();
        // "card0" only — the "card0-DP-1" connector nodes are not devices.
        if !name.starts_with("card") || name.contains('-') {
            continue;
        }
        let dev = card.path().join("device");

        let Some(busy) = read_u64(&dev.join("gpu_busy_percent")) else { continue };
        let group = format!("gpu-{index}");

        out.push(
            Metric::new(format!("gpu-{index}-load"), "GPU", busy as f64, "%", MetricKind::Load)
                .percent_of(busy as f64)
                .group(group.clone()),
        );

        if let (Some(used), Some(total)) = (
            read_u64(&dev.join("mem_info_vram_used")),
            read_u64(&dev.join("mem_info_vram_total")),
        ) {
            if total > 0 {
                let pct = used as f64 / total as f64 * 100.0;
                out.push(
                    Metric::new(format!("gpu-{index}-vram"), "Pamięć GPU", pct, "%", MetricKind::Capacity)
                        .percent_of(pct)
                        .detail(format!("{:.1} / {:.1} GB", gb(used), gb(total)))
                        .group(group),
                );
            }
        }

        index += 1;
    }
    out
}

fn gb(bytes: u64) -> f64 {
    bytes as f64 / 1024f64.powi(3)
}

/// Fields asked of nvidia-smi, in the order they come back.
const NVIDIA_FIELDS: &str =
    "name,utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw";

fn nvidia_smi() -> Vec<Metric> {
    let Ok(out) = Command::new("nvidia-smi")
        .args(["--query-gpu", NVIDIA_FIELDS, "--format", "csv,noheader,nounits"])
        .output()
    else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }

    String::from_utf8_lossy(&out.stdout)
        .lines()
        .enumerate()
        .flat_map(|(i, line)| parse_nvidia_line(i, line))
        .collect()
}

/// One card's row. Split out so the parsing is testable without the tool
/// installed — the field order is a contract with the command line above.
pub(crate) fn parse_nvidia_line(index: usize, line: &str) -> Vec<Metric> {
    let cols: Vec<&str> = line.split(',').map(str::trim).collect();
    if cols.len() < 6 {
        return Vec::new();
    }

    let name = cols[0].to_string();
    let group = format!("gpu-{index}");
    let num = |s: &str| s.parse::<f64>().ok().filter(|v| v.is_finite());
    let mut out = Vec::new();

    // Each field is independent: a card that reports load but not power
    // contributes the one it has. "[N/A]" is what the tool prints for a
    // counter the card does not implement.
    if let Some(load) = num(cols[1]) {
        out.push(
            Metric::new(format!("gpu-{index}-load"), "GPU", load, "%", MetricKind::Load)
                .percent_of(load)
                .detail(name.clone())
                .group(group.clone()),
        );
    }
    if let Some(temp) = num(cols[2]) {
        out.push(
            Metric::new(format!("temp-gpu-{index}"), "Karta graficzna", temp, "°C", MetricKind::Temperature)
                .detail(name.clone())
                .group(group.clone()),
        );
    }
    if let (Some(used), Some(total)) = (num(cols[3]), num(cols[4])) {
        if total > 0.0 {
            let pct = used / total * 100.0;
            out.push(
                Metric::new(format!("gpu-{index}-vram"), "Pamięć GPU", pct, "%", MetricKind::Capacity)
                    .percent_of(pct)
                    .detail(format!("{:.1} / {:.1} GB", used / 1024.0, total / 1024.0))
                    .group(group.clone()),
            );
        }
    }
    if let Some(watts) = num(cols[5]) {
        out.push(
            Metric::new(format!("gpu-{index}-power"), "Pobór GPU", watts, "W", MetricKind::Power)
                .group(group),
        );
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact shape this machine's card returns.
    const REAL: &str = "NVIDIA GeForce RTX 4070 Ti, 20, 33, 964, 12282, 23.86";

    #[test]
    fn a_real_row_yields_every_reading() {
        let m = parse_nvidia_line(0, REAL);
        let ids: Vec<&str> = m.iter().map(|x| x.id.as_str()).collect();
        assert_eq!(ids, ["gpu-0-load", "temp-gpu-0", "gpu-0-vram", "gpu-0-power"]);
        assert_eq!(m[0].value, 20.0);
        assert_eq!(m[1].value, 33.0);
        assert_eq!(m[3].value, 23.86);
    }

    /// Memory arrives in mebibytes and has to read as gigabytes.
    #[test]
    fn memory_is_reported_in_units_a_person_uses() {
        let m = parse_nvidia_line(0, REAL);
        assert_eq!(m[2].detail.as_deref(), Some("0.9 / 12.0 GB"));
    }

    /// A counter the card does not implement must drop out, not become zero.
    #[test]
    fn unavailable_counters_are_absent_not_zero() {
        let m = parse_nvidia_line(0, "Old Card, 15, [N/A], 100, 2048, [N/A]");
        let ids: Vec<&str> = m.iter().map(|x| x.id.as_str()).collect();
        assert_eq!(ids, ["gpu-0-load", "gpu-0-vram"], "temperature and power omitted");
    }

    #[test]
    fn a_truncated_row_is_ignored() {
        assert!(parse_nvidia_line(0, "broken").is_empty());
    }

    #[test]
    fn a_second_card_is_numbered_separately() {
        let m = parse_nvidia_line(1, REAL);
        assert_eq!(m[0].id, "gpu-1-load");
        assert_eq!(m[0].group.as_deref(), Some("gpu-1"));
    }
}
