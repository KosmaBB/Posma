# Building and development

## Requirements

- [Rust toolchain](https://rustup.rs) (stable)
- Node.js 20+
- [Tauri system dependencies](https://tauri.app/start/prerequisites/) for
  your OS — on Debian/Ubuntu that's `libwebkit2gtk-4.1-dev`,
  `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`,
  `build-essential`, `curl`, `wget`, `file`, `libssl-dev`

## First build

```bash
npm --prefix core install
bash scripts/sync-sidecars.sh
npm --prefix core run tauri dev
```

**The order matters.** `sync-sidecars.sh` builds every crate under
`modules/` and copies each binary to
`core/src-tauri/binaries/<module>-<target-triple>` — the naming Tauri's
sidecar resolution requires. Those binaries are deliberately not committed,
so on a fresh clone they don't exist yet, and Tauri refuses to build:

```
resource path `binaries/system-info-x86_64-unknown-linux-gnu` doesn't exist
```

That message looks like a corrupt checkout but isn't — it's the expected
state before the first sync. `cargo build --workspace` alone will not fix it.

Re-run `sync-sidecars.sh` after changing any module: the app uses the copied
binaries, so edits aren't picked up until they're re-synced.

## Layout

```
core/
  src/            React UI
  src-tauri/      Rust backend, tauri.conf.json, capabilities/
crates/
  broker-common/  Shared privileged-operation catalog, guards, dispatch
modules/
  <feature>/      One crate per module
  *-broker/       Per-OS privileged brokers
scripts/
  sync-sidecars.sh
```

## Common tasks

```bash
cargo build --workspace          # all Rust (after the first sidecar sync)
cargo build -p temp-clean        # one module
cargo test --workspace           # unit tests
cargo test -p vault -- --ignored # tests needing a real OS credential store

npm --prefix core run build      # tsc + vite production build
cd core && npx tsc --noEmit      # typecheck only
```

## Talking to a module directly

Modules are plain processes speaking one-line JSON, which makes them easy to
exercise without the UI:

```bash
echo '{"cmd":"scan"}' | ./target/debug/temp-clean | python3 -m json.tool
echo '{"op":"capabilities"}' | ./target/debug/linux-broker
```

This is the primary way to test module logic. `{"op":"capabilities"}` against
any broker reports which operations that platform actually implements.

## Adding a new sidecar — order of operations

Adding a binary to `externalBin` **before** it exists breaks the Tauri build
and takes `tauri dev` down with it. Correct order:

1. write the crate
2. `bash scripts/sync-sidecars.sh`
3. add `"binaries/<name>"` to `externalBin` in `tauri.conf.json`
4. restart `tauri dev`

## Tests that need a desktop session

The vault stores its encryption key in the OS credential store (Secret
Service, Keychain, Credential Manager). The test that exercises that path
end-to-end is marked `#[ignore]`, because a headless machine — CI included —
has no credential store to talk to, and a test that cannot run should say so
rather than fail.

Run it on a normal desktop session:

```bash
cargo test -p vault -- --ignored
```

It uses a disposable service name, never the production one, and removes its
entry afterwards. The encoding and length-validation logic around it is
covered by ordinary tests that run everywhere.

## Testing rules

Test rejection paths against real binaries: malformed requests, paths outside
whitelists, names that could be read as flags.

**Do not run destructive success paths against your own machine.** Removing a
package, vacuuming logs, writing boot configuration — verify those by reading
the code and by testing the refusals, or use a disposable VM. This is a
project rule, not a suggestion; ignoring it has already cost real data once.

## Environment notes

Some editors (notably VS Code installed as a snap on Linux) inject GTK/GDK
and locale variables into terminal child processes that crash the compiled
Tauri binary with a `libpthread` symbol lookup error. If launching the built
app from an integrated terminal fails that way, launch it from a clean
environment (`env -i` keeping only `HOME`, `USER`, `LANG`, `DISPLAY`,
`XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS` and an explicit `PATH`), or from
a normal terminal outside the editor.

Also: a dev-profile build honours `devUrl` from `tauri.conf.json`, so running
the compiled binary directly without the Vite dev server shows
"Could not connect to localhost". Use `npm --prefix core run tauri dev`.
