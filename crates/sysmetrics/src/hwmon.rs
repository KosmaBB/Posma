//! Temperatures the kernel exposes through `/sys/class/hwmon`.
//!
//! These are world-readable text files, so nothing here needs elevation —
//! unlike S.M.A.R.T., which goes through a raw device ioctl and does.
//! Anything unreadable is skipped: a missing sensor is not a failure.

use std::fs;

use crate::{Metric, MetricKind};

/// One reading straight out of sysfs.
pub struct Reading {
    pub chip: String,
    pub label: Option<String>,
    pub celsius: f64,
}

pub fn read() -> Vec<Reading> {
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
/// A machine reports temperatures for its network controller and voltage
/// regulator too. Showing all of them turns a dashboard into a sensor dump,
/// so each of these is an allow-list and an unknown chip contributes
/// nothing rather than an unlabelled number.
const CPU_CHIPS: [&str; 5] = ["k10temp", "coretemp", "zenpower", "cpu_thermal", "acpitz"];
const DRIVE_CHIPS: [&str; 2] = ["nvme", "drivetemp"];
/// Open-source drivers expose the card here. NVIDIA's proprietary driver
/// does not, which is why `gpu::metrics` asks `nvidia-smi` instead.
const GPU_CHIPS: [&str; 4] = ["amdgpu", "nouveau", "i915", "xe"];

pub fn cpu_temperature(readings: &[Reading]) -> Option<Metric> {
    // Tctl and "Package id 0" are whole-package figures; the per-core
    // sensors beneath them run cooler and would understate the number.
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

    Some(
        Metric::new("temp-cpu", "Procesor", best.celsius.round(), "°C", MetricKind::Temperature)
            .detail(best.chip.clone()),
    )
}

pub fn drive_temperatures(readings: &[Reading]) -> Vec<Metric> {
    let mut drives: Vec<&Reading> = readings
        .iter()
        .filter(|r| DRIVE_CHIPS.contains(&r.chip.as_str()))
        // NVMe reports a composite figure plus per-sensor detail; the
        // composite is the drive's own summary.
        .filter(|r| r.label.as_deref().is_none_or(|l| l.eq_ignore_ascii_case("Composite")))
        .collect();

    drives.sort_by(|a, b| b.celsius.partial_cmp(&a.celsius).unwrap_or(std::cmp::Ordering::Equal));

    drives
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let label = if drives.len() > 1 { format!("Dysk {}", i + 1) } else { "Dysk".into() };
            Metric::new(format!("temp-drive-{i}"), label, r.celsius.round(), "°C", MetricKind::Temperature)
                .detail(r.chip.clone())
        })
        .collect()
}

/// GPU temperature for cards driven by an open-source driver. Returns
/// nothing on NVIDIA's proprietary stack, which has no hwmon node.
pub fn gpu_temperatures(readings: &[Reading]) -> Vec<Metric> {
    readings
        .iter()
        .filter(|r| GPU_CHIPS.contains(&r.chip.as_str()))
        .filter(|r| r.label.as_deref().is_none_or(|l| l.eq_ignore_ascii_case("edge")))
        .enumerate()
        .map(|(i, r)| {
            Metric::new(
                format!("temp-gpu-{i}"),
                "Karta graficzna",
                r.celsius.round(),
                "°C",
                MetricKind::Temperature,
            )
            .detail(r.chip.clone())
            .group(format!("gpu-{i}"))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(chip: &str, label: Option<&str>, celsius: f64) -> Reading {
        Reading { chip: chip.into(), label: label.map(String::from), celsius }
    }

    #[test]
    fn no_sensors_yields_nothing() {
        assert!(cpu_temperature(&[]).is_none());
        assert!(drive_temperatures(&[]).is_empty());
        assert!(gpu_temperatures(&[]).is_empty());
    }

    #[test]
    fn unknown_chips_contribute_nothing() {
        let readings = vec![r("r8169_0_2a00:00", None, 38.0), r("jc42", None, 42.0)];
        assert!(cpu_temperature(&readings).is_none());
        assert!(drive_temperatures(&readings).is_empty());
        assert!(gpu_temperatures(&readings).is_empty());
    }

    #[test]
    fn package_sensor_wins_over_per_core() {
        let readings = vec![r("k10temp", Some("Tccd1"), 43.0), r("k10temp", Some("Tctl"), 57.0)];
        assert_eq!(cpu_temperature(&readings).unwrap().value, 57.0);
    }

    #[test]
    fn only_composite_nvme_readings_are_used() {
        let readings = vec![
            r("nvme", Some("Composite"), 42.0),
            r("nvme", Some("Sensor 1"), 44.0),
            r("nvme", Some("Composite"), 34.0),
        ];
        let drives = drive_temperatures(&readings);
        assert_eq!(drives.len(), 2);
        assert_eq!(drives[0].value, 42.0, "hottest first");
    }

    #[test]
    fn a_lone_drive_is_not_numbered() {
        assert_eq!(drive_temperatures(&[r("drivetemp", None, 31.0)])[0].label, "Dysk");
    }

    #[test]
    fn an_open_source_gpu_driver_is_picked_up() {
        let m = gpu_temperatures(&[r("amdgpu", Some("edge"), 61.0)]);
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].value, 61.0);
        assert_eq!(m[0].group.as_deref(), Some("gpu-0"));
    }
}
