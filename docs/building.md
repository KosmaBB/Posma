# Building and development

## Requirements

- [Rust toolchain](https://rustup.rs) (stable)
- Node.js 20+
- [Tauri system dependencies](https://tauri.app/start/prerequisites/) for
  your OS. On Linux the package names differ by family:

  ```bash
  # Debian, Ubuntu, Mint, Pop!_OS, Zorin, elementary, Kali, MX
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
      librsvg2-dev build-essential curl wget file libssl-dev libxdo-dev

  # Arch, CachyOS, Manjaro, EndeavourOS, Garuda
  sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl \
      appmenu-gtk-module libappindicator-gtk3 librsvg xdotool

  # Fedora, Nobara
  sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
      libappindicator-gtk3-devel librsvg2-devel gcc gcc-c++ make

  # RHEL 10, AlmaLinux 10, Rocky 10: the same, after enabling EPEL,
  # which is where WebKitGTK lives there
  sudo dnf install epel-release && sudo dnf config-manager --set-enabled crb

  # openSUSE — by capability, because the package has been renamed
  # (webkit2gtk3-devel, now webkitgtk3-devel)
  sudo zypper install 'pkgconfig(webkit2gtk-4.1)' libopenssl-devel curl wget file \
      libappindicator3-1 librsvg-devel gcc gcc-c++ make
  ```

  RHEL 9 and its rebuilds cannot build the app at all: they package only
  the older WebKitGTK 4.0, and Tauri needs 4.1.

  These lists are checked, not remembered: `scripts/distro-check.sh --build`
  installs exactly them in a container of each family and compiles the
  workspace there. [Linux distributions](distributions.md) has the result
  per distribution.

## First build

```bash
npm --prefix core install
npm --prefix core run tauri dev
```

`tauri dev` now syncs the sidecars itself before starting, so a module
edited without a re-sync can no longer reach a running app — that mismatch
crashed the health monitor once, because the interface expected a field the
stale binary did not send. A no-op sync costs about a second and a half.

To sync without starting anything:

```bash
node scripts/sync-sidecars.mjs
```

It is a Node script, not a shell one, so it runs the same on Windows,
where `bash` in a script usually resolves to WSL and would build the Linux
modules.

**Why the sync exists.** `sync-sidecars.mjs` builds the modules meant for
this system and copies each binary to
`core/src-tauri/binaries/posma-<module>-<target-triple>` — the naming Tauri's
sidecar resolution requires. The `posma-` prefix is there because a Linux
package installs sidecars into `/usr/bin`, where a bare `vault` would
collide with HashiCorp Vault's. Those binaries are deliberately not committed,
so on a fresh clone they don't exist yet, and Tauri refuses to build:

```
resource path `binaries/posma-system-info-x86_64-unknown-linux-gnu` doesn't exist
```

That message looks like a corrupt checkout but isn't — it's the expected
state before the first sync. `cargo build --workspace` alone will not fix it.

Re-run `sync-sidecars.mjs` after changing any module: the app uses the copied
binaries, so edits aren't picked up until they're re-synced.

## Layout

```
core/
  src/            React UI
  src-tauri/      Rust backend, tauri.conf.json, capabilities/
crates/
  broker-common/  Shared privileged-operation catalog, guards, dispatch
  distro/         Which Linux this is — package manager, kernels, GRUB layout
modules/
  <feature>/      One crate per module
  *-broker/       Per-OS privileged brokers
scripts/
  sync-sidecars.mjs
  distro-check.sh
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
2. `node scripts/sync-sidecars.mjs`
3. add `"binaries/posma-<name>"` to `externalBin` in `tauri.<platform>.conf.json`
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

## Building for another system

POSMA is developed on Linux and tested on the machine that runs the system
being targeted. A Tauri bundle cannot be cross-compiled — the macOS bundler
and Apple's linker only run on macOS — so a build for another system is made
*on* that system, from the same source.

**Moving a version to the Mac** is therefore a pull, not a file transfer:

```bash
git pull
npm --prefix core ci
node scripts/sync-sidecars.mjs
npm --prefix core run tauri dev
```

`sync-sidecars.mjs` builds only the modules whose `module.json` lists the
system it is running on, so a macOS build carries no GRUB editor and a Linux
one carries no Time Machine module. Which sidecars the bundle expects comes
from `tauri.<platform>.conf.json`, which replaces the base list rather than
adding to it.

A release build (`sync-sidecars.mjs release`, `tauri build`) uses the
workspace's `[profile.release]`: whole-program optimisation and stripped
symbols make every binary about a third smaller. The price is a slower
build, and a panic that names no functions in its backtrace — reproduce
those with a debug build.

### Another Linux distribution

The source builds on each supported family with that family's own
packages — see [Requirements](#requirements). A *binary* is less portable
than the source: built on Ubuntu 24.04 it needs glibc 2.39 and will not
start on Debian 12, Ubuntu 22.04 or RHEL 9. A build travels to newer
systems, never to older ones, so anything meant to be handed out is built
on the oldest system it has to support. [Linux distributions](distributions.md)
has the details.

### Both Mac architectures

A plain sync builds for the host architecture only, which is what `tauri
dev` resolves and is far quicker. One bundle that runs on both Intel and
Apple silicon needs each sidecar built twice and joined:

```bash
rustup target add x86_64-apple-darwin aarch64-apple-darwin
node scripts/sync-sidecars.mjs release --universal
npm --prefix core run tauri build -- --target universal-apple-darwin
```

`--universal` builds every module for both targets, keeps the
per-architecture copies so `tauri dev` still works on either machine, and
joins them with `lipo` into `posma-<module>-universal-apple-darwin`. A missing
Rust target is reported before the first build rather than as a linker
error several minutes in.

### Checking other systems without leaving this one

Rust for a foreign target can be type-checked locally, which catches the
portability mistakes that otherwise wait until the code reaches the other
machine:

```bash
rustup target add aarch64-apple-darwin
cargo check --target aarch64-apple-darwin -p macos-broker
```

This found a real one: `broker-common` guarded its peer-credential lookup
with `#[cfg(unix)]`, which is true on macOS, while the body used Linux-only
`SO_PEERCRED`. Every broker depends on that crate, so the macOS broker could
not have compiled on a Mac at all.

Its limit is worth knowing: it verifies our Rust, not crates that compile C.
`vault` fails this check because `libsqlite3-sys` builds bundled SQLite and
needs a macOS C toolchain. That is a cross-compilation limit, not a
portability defect — it builds on a real Mac.

The same works for Windows with `rustup target add x86_64-pc-windows-msvc`;
the Linux and macOS brokers are a Unix-socket daemon at heart and are never
built for it. `cargo check --target x86_64-pc-windows-msvc -p core` works
too, once `core/src-tauri/binaries/` holds a file for each Windows sidecar —
an empty one will do, the build only checks that it exists. What a type
check cannot catch, CI does: it builds and tests every module on Apple
silicon, on Intel and on Windows — on Windows also the elevated broker
session, end to end. A version tag builds the installers, described next.

## Installers

Pushing a tag `v*` runs `.github/workflows/release.yml`, which builds the
installers and puts them in a **draft** release — nothing is public until
the draft is published by hand. Run from the Actions tab instead, it builds
the same files as workflow artifacts and releases nothing.

| System | Files | Built on |
|---|---|---|
| Linux | `.deb` (apt family), `.rpm` (dnf, zypper) | Ubuntu 22.04, the oldest glibc supported |
| macOS | one universal `.dmg` for Apple silicon and Intel | macOS 15 |
| Windows | `.exe` (NSIS) | GitHub's `windows-latest` |

Locally, on the system the installer is for:

```bash
npm --prefix core ci
npm --prefix core run tauri build      # Linux: target/release/bundle/{deb,rpm}
                                       # Windows: target/release/bundle/nsis
```

For the Mac, the universal build from [Both Mac architectures](#both-mac-architectures).

**No AppImage.** An AppImage runs from a FUSE mount that only the user who
started it can read — root included is refused — so `pkexec` could never
start the broker from inside it, and every privileged operation would fail.
The packages install the broker into `/usr/bin`, owned by root.

There is no pacman package yet: on Arch and its descendants POSMA builds
from source as above.

**The Mac app is signed ad hoc, not by a developer.** Without an Apple
developer account there is no identity to sign with; the ad-hoc signature
(`signingIdentity: "-"` in `tauri.macos.conf.json`) at least keeps
Gatekeeper from calling a downloaded copy damaged. The first start is
still refused as from an unidentified developer: System Settings → Privacy
& Security → *Open Anyway*, once.

**The Windows installer installs for all users, into Program Files**
(`installMode: perMachine` in `tauri.windows.conf.json`), and so asks for an
administrator once. A per-user install would put the broker — the binary
UAC runs as administrator — in a folder the user's own programs can
write, where anything could replace it and wait for the next consent. It is
unsigned too, so SmartScreen warns on first start: *More info* → *Run
anyway*.

## Testing rules

Test rejection paths against real binaries: malformed requests, paths outside
whitelists, names that could be read as flags.

**Do not run destructive success paths against your own machine.** Removing a
package, vacuuming logs, writing boot configuration — verify those by reading
the code and by testing the refusals, or use a disposable VM. This is a
project rule, not a suggestion; ignoring it has already cost real data once.

For package and kernel operations the disposable machine exists:
`scripts/distro-check.sh` starts a container of each supported distribution
and runs the success paths there — a package removed, orphans swept, a
cache emptied, an old kernel taken out — against that distribution's real
package manager. Run it after changing anything that calls one:

```bash
rustup target add x86_64-unknown-linux-musl   # once
bash scripts/distro-check.sh --kernels --grub
```

What it cannot reach is listed in [Linux distributions](distributions.md):
a real boot through a rebuilt GRUB menu still needs a VM.

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

**"Could not create GBM EGL display: EGL_NOT_INITIALIZED. Aborting..."**
is WebKitGTK's DMA-BUF renderer failing to reach the GPU, and it takes the
whole process down. It happened on this project's own machine: an NVIDIA
driver update had installed new libraries while the old kernel module was
still loaded, and `nvidia-smi` reported a version mismatch until a reboot.
The same failure is common under NVIDIA generally and in virtual machines.

The app now sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` for itself on Linux
before anything starts, which takes the rendering path that always works.
An explicit value is respected — `WEBKIT_DISABLE_DMABUF_RENDERER=0` turns
the DMA-BUF renderer back on. If a driver update is waiting for a reboot,
the reboot is still worth doing: other programs using the GPU are affected
too.
