# POSMA

**P**ersonal **O**perating **S**ystem **M**aintenance **A**pp

A maintenance app for Windows, macOS and Linux whose entire source is open to
inspection — including every line that touches your system with administrator
rights. Built on Tauri (Rust core + React UI).

The idea is simple: keeping a computer in shape should be *convenient*, and
you should be able to *verify* what the tool doing it actually does. Most
maintenance software makes you pick one or the other.

> **Status: work in progress.** Linux is feature-complete against the planned
> module catalog; macOS and Windows are scaffolded but not yet verified on
> real hardware. Installers come later — for now this is a source repository.

---

## What POSMA is for

**One app, every popular system.** The same interface and the same habits on
Windows, macOS and Linux, instead of a different tool and a different mental
model per machine. Where a feature genuinely doesn't exist on a platform,
POSMA says so plainly rather than pretending.

**Not bloatware — you decide what it contains.** POSMA ships as a small core
plus a catalog of modules. Each module is a separate program the core starts
only when you use it.

- Don't need a password vault? Don't install it. It isn't there — not hidden,
  not disabled, *not present*.
- Changed your mind later? Install it in seconds, any time.
- Removing a module means **every bit of it goes** — the program itself and,
  if you ask, its settings and data too. No leftovers, no dormant services,
  nothing quietly staying behind.

You are never made to carry features you don't want. That is a design
constraint, not a preference — it's why modules are separate executables
instead of code compiled into one binary.

**Open about what it does with your system.** POSMA needs administrator
rights for some jobs — that's unavoidable for a maintenance tool. What isn't
unavoidable is asking you to take it on faith. The full source is published
so you (or anyone you trust) can read exactly what happens, and the
architecture is built so that reading it is *feasible*: the privileged parts
are small, separate and deliberately boring.

## Modules

| Folder | Modules |
|---|---|
| **Data & files** | temp cleanup · large files · duplicates (content + version-aware) · shredder · metadata stripping · package caches |
| **System** | disk map · autostart manager · health monitor (CPU/RAM/S.M.A.R.T.) · kernel version manager · visual GRUB editor |
| **Security** | browser hygiene · encrypted password vault (Argon2id + AES-256-GCM) |
| **Applications** | uninstaller with leftover detection (apt / snap / flatpak) |

## How the privileged side is kept reviewable

Transparency only means something if the security-critical code is small
enough to actually audit. So:

- **Modules never hold privileges.** They run as you. When one needs
  something privileged, it asks the core, which asks a **broker**.
- **The broker has a closed catalog of operations** — there is no "run this
  command as root" call anywhere. New privileged capabilities are added as
  reviewed operations, not by widening existing ones.
- **The broker re-validates every request itself**, never trusting what the
  unprivileged side already checked, and **fails closed** when it can't
  determine whether something is safe. Removing a kernel, for instance, makes
  the root process independently work out which kernel is running and which
  is newest, refuse both, and refuse outright if it cannot tell.
- **Destructive edits are reversible:** system config changes go through
  backup → rotation → atomic write → verification → automatic rollback if the
  verification fails.
- **Elevation is your choice:** a prompt per action, or an installed helper
  for prompt-free use, where access is granted by the caller's verified user
  ID rather than by file permissions.

Full design: [`Access_plan.md`](Access_plan.md). Shared implementation:
[`crates/broker-common`](crates/broker-common).

## Layout

```
core/            Tauri app — Rust backend (src-tauri) + React UI (src)
crates/
  broker-common/ Shared privileged-operation catalog, guards, dispatch
modules/         One crate per feature module, plus the per-OS brokers
scripts/         sync-sidecars.sh — builds modules into the app bundle
```

## Building from source

End users will get an installer; this section is for developers and for
anyone who would rather build the thing they audited.

Requires a [Rust toolchain](https://rustup.rs), Node.js 20+, and the
[Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS.

```bash
npm --prefix core install
bash scripts/sync-sidecars.sh   # build modules, copy them into the bundle
npm --prefix core run tauri dev
```

**Run `sync-sidecars.sh` before the first build.** Compiled module binaries
are deliberately not committed, and the app bundles them, so a fresh clone
fails until they exist. Skipping this step gives an error that looks like a
broken checkout:

```
resource path `binaries/system-info-x86_64-unknown-linux-gnu` doesn't exist
```

That is the expected state before the first sync, not a corrupt clone —
`cargo build --workspace` alone will not resolve it.

Re-run the script after changing any module, too: the app uses the copied
binaries, so edits are not picked up until they are re-synced.

## Licensing

POSMA's source is published in full and dual-licensed, on the model WinRAR
popularised:

- **Free** for private individuals, research, education, charities and public
  bodies — under [PolyForm Noncommercial 1.0.0](LICENSE.md).
- **Paid** for companies and commercial use — see
  [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

To be precise about terms: this is **source-available**, not "open source" in
the [OSI](https://opensource.org/osd) sense, because that definition forbids
restricting commercial use. Everything is readable, auditable and modifiable;
companies are simply expected to pay for commercial use.

## Contributing

Issues and pull requests are welcome. Two ground rules, both non-negotiable
because of what this software does:

1. **No new privileged behaviour outside the broker catalog** — no `sudo`,
   `pkexec` or shell-out-as-root inside a module, however tightly scoped it
   looks.
2. **Anything destructive gets a preview first, and validation on the
   privileged side**, independent of whatever the UI already checked.

By contributing you agree your contributions are licensed under the same
dual-license terms as the project.
