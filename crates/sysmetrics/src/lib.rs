//! Readings a machine will give up about itself, without any privilege.
//!
//! Every reading is optional and every source is independent. A collector
//! that finds nothing returns an empty list, not a zero — a machine with no
//! discrete GPU is not a machine whose GPU sits at 0%.
//!
//! Adding a source is adding a function to `collect`. Nothing downstream
//! changes: the payload is a list, the interface renders what arrived, and
//! the treatment follows each metric's `kind` rather than its name.

pub mod gpu;
pub mod hwmon;

use serde::Serialize;

/// How the interface should treat a reading, without knowing what it is.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum MetricKind {
    /// Fluctuates constantly; worth plotting over time.
    Load,
    /// A fill level, between zero and a ceiling.
    Capacity,
    /// Degrees Celsius.
    Temperature,
    /// Watts.
    Power,
}

#[derive(Serialize, Clone, Debug)]
pub struct Metric {
    /// Stable across readings — the interface keys history by it.
    pub id: String,
    pub label: String,
    pub value: f64,
    pub unit: String,
    /// 0..100 where the reading maps onto a bar. Absent where it does not:
    /// a GPU at 33 °C has no meaningful "percent full".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<f64>,
    /// Secondary line, already formatted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub kind: MetricKind,
    /// Groups related readings so they can be shown together — "gpu-0" for
    /// a card's load, memory and temperature.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
}

impl Metric {
    pub fn new(id: impl Into<String>, label: impl Into<String>, value: f64, unit: &str, kind: MetricKind) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            value,
            unit: unit.into(),
            percent: None,
            detail: None,
            kind,
            group: None,
        }
    }

    pub fn percent_of(mut self, percent: f64) -> Self {
        self.percent = Some(percent);
        self
    }

    pub fn detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn group(mut self, group: impl Into<String>) -> Self {
        self.group = Some(group.into());
        self
    }
}

/// Everything this machine will report, from every source.
///
/// Sources are asked in turn and none can stop another: a collector that
/// panics on someone else's hardware would take the whole reading with it,
/// so each returns a list and an empty one is a normal answer.
pub fn collect() -> Vec<Metric> {
    let readings = hwmon::read();
    let mut out = Vec::new();
    out.extend(hwmon::cpu_temperature(&readings));
    out.extend(hwmon::drive_temperatures(&readings));
    out.extend(hwmon::gpu_temperatures(&readings));
    out.extend(gpu::metrics());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_temperature_carries_no_fill_level() {
        let m = Metric::new("temp-cpu", "Procesor", 57.0, "°C", MetricKind::Temperature);
        assert!(m.percent.is_none());
    }

    #[test]
    fn builders_compose() {
        let m = Metric::new("gpu-0-load", "GPU", 20.0, "%", MetricKind::Load)
            .percent_of(20.0)
            .detail("RTX 4070 Ti")
            .group("gpu-0");
        assert_eq!(m.percent, Some(20.0));
        assert_eq!(m.group.as_deref(), Some("gpu-0"));
    }

    /// Runs against whatever the build machine has. It asserts shape, not
    /// content: a machine with no sensors is a valid machine.
    #[test]
    fn collecting_never_panics_and_never_invents() {
        for m in collect() {
            assert!(!m.id.is_empty());
            assert!(!m.label.is_empty());
            assert!(m.value.is_finite(), "{} produced {}", m.id, m.value);
            if let Some(p) = m.percent {
                assert!((0.0..=100.0).contains(&p), "{} percent {p}", m.id);
            }
        }
    }
}
