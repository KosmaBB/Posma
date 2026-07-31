# Contributing to POSMA

*[Wersja polska →](CONTRIBUTING.pl.md)*

Issues and pull requests are welcome. This file covers the rules that are
specific to this project; [docs/](docs/) covers how everything works.

## Before you start

- **Bug reports** — say which OS, and include the exact error text if there
  is one. If a module misbehaved, the output of talking to it directly is
  worth a lot: `echo '{"cmd":"scan"}' | ./target/debug/<module>`.
- **Security issues** — do not open a public issue. See
  [SECURITY.md](SECURITY.md).
- **Larger changes** — open an issue first. A new module or a new privileged
  operation is a design conversation, not just a patch.

## The two rules that are not negotiable

Both exist because of what this software does with administrator rights.

1. **No new privileged behaviour outside the broker catalog.** No `sudo`,
   `pkexec`, setuid or shell-out-as-root inside a module, however tightly
   scoped it looks. If a feature needs root, the privileged half becomes a
   reviewed operation in `crates/broker-common`, and the module reports an
   honest error without it.

2. **Anything destructive previews first, and is validated on the privileged
   side.** Scanning and acting are separate commands. The broker re-checks
   every input itself rather than trusting what the UI or a module already
   verified, and refuses when it cannot determine whether an action is safe.

A patch that breaks either will not be merged, even if it works.

## Practical expectations

**Fail closed.** If you can't tell whether something is safe to touch,
refuse. Never let an unreadable value become a default that quietly disables
a check.

**Reuse the shared guards.** `crates/broker-common/src/guards.rs` holds path
containment, name validation, same-file detection, atomic writes and the
backup/rollback pipeline. Use them rather than writing the check again — each
one guards against a specific mistake, and a second copy is a second thing to
get wrong.

**Test the guards you touch.** Security-critical helpers have unit tests, and
those tests are written so they fail if the guard is removed. If you add a
guard, add a test that would catch its absence.

**Be honest in the UI and in docs.** A feature that only works on some setups
should say so. Documentation that claims more than the code delivers is
treated as a bug here.

## Development

See [docs/building.md](docs/building.md) for the toolchain and the build
order. The short version:

```bash
npm --prefix core install
bash scripts/sync-sidecars.sh   # required before the first build
npm --prefix core run tauri dev
```

Before opening a pull request:

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
npm --prefix core run build
```

CI runs the same checks plus a dependency audit. One test is marked
`#[ignore]` because it needs a real OS credential store; run it on a desktop
session with `cargo test -p vault -- --ignored`.

## Testing rules

Test rejection paths against real binaries — malformed requests, paths
outside whitelists, names that could be read as flags.

**Do not run destructive success paths against your own machine** to check
they work. Removing packages, vacuuming logs, writing boot configuration:
verify those by reading the code and testing the refusals, or use a
disposable VM.

## Licensing of contributions

POSMA is dual-licensed (see [LICENSE.md](LICENSE.md) and
[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)). By submitting a
contribution you agree it is licensed under those same terms, including the
commercial one, so that the project can keep being offered on both.
