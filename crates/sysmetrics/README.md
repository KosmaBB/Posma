# sysmetrics

Readings a machine will give up about itself, without any privilege.

## Adding a source

One function, returning `Vec<Metric>`, added to `collect()` in `lib.rs`.
Nothing downstream changes — not the sidecars, not the dashboard, not the
health monitor. GPU support arrived this way and appeared in the interface
without either view being edited.

```rust
pub fn fan_speeds() -> Vec<Metric> {
    // Nothing to report is an empty list, never a zero.
    vec![Metric::new("fan-0", "Wentylator", rpm, "RPM", MetricKind::Load)
        .detail("obudowa")
        .group("cooling")]
}
```

## The rules a source follows

**Absence is absence.** A machine with no discrete card is not a machine
whose GPU sits at 0%. A collector that finds nothing returns an empty list,
and the reading simply is not there.

**No privilege.** Everything here reads world-readable files or runs an
unprivileged tool. Anything needing root belongs behind the broker — that is
where S.M.A.R.T. lives, and why it is not in this crate.

**Allow-lists, not everything.** A machine reports temperatures for its
network controller and voltage regulator. Listing all of them turns a
dashboard into a sensor dump, so each collector names the chips it
understands and ignores the rest rather than showing an unlabelled number.

**`kind` decides the treatment.** The interface plots `Load`, gives a bar to
anything with a `percent`, and shows the rest as a figure. A metric added
later renders correctly without a change on the other side.

**Cost is part of the contract.** `nvidia-smi` costs a process spawn (~25 ms)
and is asked only after sysfs comes back empty. A collector that would cost
more than the poll interval does not belong here.

## Where the readings surface

| Consumer | Uses |
|---|---|
| `system-info` | Dashboard tiles |
| `health-monitor` | The sensors section, alongside cores and processes |
