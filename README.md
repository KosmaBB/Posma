# POSMA

**P**ersonal **O**perating **S**ystem **M**aintenance **A**pp

*[Polska wersja tego dokumentu →](README.pl.md)* · *[Documentation →](https://kosmabb.github.io/Posma/)*

A maintenance app for Windows, macOS and Linux whose entire source is open to
inspection — including every line that touches your system with administrator
rights. Built on Tauri (Rust core + React UI).

The idea is simple: keeping a computer in shape should be *convenient*, and
you should be able to *verify* what the tool doing it actually does. Most
maintenance software makes you pick one or the other.

> **Status: work in progress.** Linux is feature-complete against the planned
> module catalog; macOS and Windows are scaffolded but not yet verified on
> real hardware. Installers come later — for now this is a source repository.
>
> No screenshots yet, on purpose: the interface is still being shaped, and
> showing a version that won't match what ships would be worse than showing
> nothing. They go in once the UI represents the real thing.

---

## What POSMA is for

**One app, every popular system.** The same interface and the same habits on
Windows, macOS and Linux, instead of a different tool and a different mental
model per machine. Where a feature genuinely doesn't exist on a platform,
POSMA says so plainly rather than pretending.

**Not bloatware — you decide what it contains.** POSMA is a small core plus a
catalog of modules, and each module is a genuinely separate program the core
starts only when you use it — not a feature flag, not a greyed-out menu item.

The goal this architecture exists to serve:

- Don't need a password vault? Don't install it. It isn't there — not hidden,
  not disabled, *not present*.
- Changed your mind later? Install it in seconds, any time.
- Removing a module destroys **every bit of it** — the program itself and, if
  you ask, its settings and data too. No leftovers, no dormant services,
  nothing quietly staying behind.

You should never be made to install features you don't want. That is a design
constraint, not a preference — it's why modules are separate executables
rather than code compiled into one binary.

> **Where this stands before 1.0:** the separation is real — every module is its
> own executable, and the privileged operations each one may request are
> declared per module. The in-app *install/remove* flow is not finished yet:
> the module manager currently records your choice and hides what you turned
> off, rather than adding and deleting files on disk. Real on-disk
> installation and removal arrives with **1.0**, because it needs
> distribution servers to fetch module files from — see
> [Roadmap](#roadmap).

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
enough — and readable enough — to actually audit. So:

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

## Roadmap

Every module and feature is tested on a live system in daily use. POSMA is
not developed against virtual machines, which can differ structurally from a
real installation — the product targets operating systems as people actually
run them, so that is what it is built and verified against. Nothing ships
without being fully tested first.

That is also what sets the order below: each platform is finished on hardware
it can genuinely be tested on before the next one starts.

### Where it is now — Linux ✅

Every module planned for Linux is built and working against real system data:
temp cleanup, large files, duplicates, shredder, metadata, package caches,
systemd journal trimming, disk map, autostart, health monitor, kernel
manager, GRUB editor, browser hygiene, vault, uninstaller. The privileged
broker with its closed operation catalog is complete here, in both
prompt-per-action and installed-helper modes.

### Next — macOS

The second platform that can be tested live, so it's next in line.

- Verify the scaffolded macOS broker on real hardware — Homebrew, `launchctl`,
  unified-log trimming, Time Machine snapshots and SMART are written but have
  never run on a Mac.
- macOS-only modules: Xcode derived-data cleanup, Mail/Messages cache
  slimming, Time Machine local snapshots.
- A guided Full Disk Access flow — macOS deliberately makes this grantable
  only by hand in System Settings, so POSMA can open the right pane and
  confirm the result, never grant it silently.

### Then — Windows

Built with the least hardware access, so deliberately the most conservative.

- A named-pipe helper with proper caller authentication. The Unix side uses
  the peer's verified user ID; the Windows equivalent is exactly the kind of
  security-critical code that should not be written blind, so it is
  intentionally still missing rather than guessed at.
- Windows-only modules: WinSxS/DISM component cleanup, service profiles,
  bloatware removal, a winget front end.
- Automatic restore point before every critical operation.

### 1.0 — module distribution

Real install and removal needs somewhere to fetch modules *from*, so both
land together at the 1.0 release:

- **Distribution servers** that POSMA requests module files from.
- **Real module install and removal** — the manager becomes genuine on-disk
  add/delete, with the choice between removing the module alone or the module
  together with its settings and data. This is what turns the modularity
  described above from architecture into a feature.
- **Module vetting** for everything served — see
  [Module security](#module-security) below.

### Long term

- **Community modules, plugins and translations** — a place for other people
  to extend POSMA, with the same review standard applied to anything
  distributed through official channels.
- Polish and English are the baseline languages; the goal is for community
  translations to be first-class rather than bolted on.

### Beyond 1.0 — Master Control (business tier, exploratory)

Every office has someone who keeps the machines running, and the current
state of that job is grim: provisioning a new workstation usually means
Clonezilla and half an hour of watching a progress bar, and anything more
involved means lines of bash or an unpleasant decade-old single-purpose tool.
Intune and Jamf exist, but they are priced and scoped for organisations far
larger than the ones actually stuck with this problem.

Master Control is the plan to address that: one console, acting on any
machine on the network running POSMA — fleet-wide maintenance, workstation
provisioning, a registry of company account credentials, and scheduled
actions and policies.

This is where the commercial licence earns its keep, and it is the natural
home for the paid tier.

**It is not started, and it is intentionally last.** Turning POSMA into
something that accepts instructions over a network inverts its entire threat
model — today no component listens on a socket that isn't local, and a
compromised console would mean a compromised fleet. Three constraints are
already fixed, before any of it is designed:

1. **Off by default, always.** Installing POSMA never makes a machine
   remotely controllable. Enrolment is a deliberate, explicit act on both
   ends.
2. **The closed operation catalog still applies** — Master Control gets no
   "run this command" escape hatch, ever. Remote control that can only invoke
   reviewed operations is a fundamentally different (and much smaller) risk
   than remote shell access, and that difference is the point.
3. **The local user-ID check does not stretch over a network.** Remote access
   needs its own authenticated, mutually-verified enrolment, and every
   privileged action taken remotely lands in an audit log.

A shared company credential registry is likewise a different problem from the
current local vault — shared secrets, per-person access, revocation and audit
are not something to bolt onto a single-user design.

### Core work, regardless of platform
- **Permissions UI** — a Settings → Access view listing every capability,
  what needs it, whether it's granted, and a repair action; plus onboarding
  wired to real helper installation instead of recording a preference.
- **Custom modules** — install a module you or someone else wrote, with a
  consent screen showing exactly which privileged capabilities it declares.
- **Installers** — `.exe`, `.deb`/`.rpm`/AppImage and `.dmg`, so using POSMA
  doesn't require a build toolchain.
- **Desktop personalisation** as its own module (GNOME, KDE Plasma), applying
  the same one-click approach the GRUB editor uses for boot themes.
- **Manifest enforcement** — the core does not yet verify at call time that
  the module making a privileged request actually declared the capability it
  needs; today the check is only that the user granted it. See
  [docs/security-model.md](docs/security-model.md).
- Smaller items: `pacman`/`dnf` support, flatpak unused-runtime cleanup,
  settings persistence beyond the browser store, post-onboarding tutorial.

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

## Module security

Modules are the one place where POSMA could plausibly be turned against the
person running it, so anything distributed through official channels (see
[1.0 — module distribution](#10--module-distribution)) is held to a fixed
standard:

- **No external scripts.** A module does not download, generate or execute
  code from anywhere else. What ships is what runs.
- **No fetching external files, scripts or code at runtime.** A module that
  needs data brings it or asks the system for it — it does not reach out and
  pull executable content.
- **Every module is reviewed before it is served**, including its declared
  privileged capabilities, and reviewed again on every update.
- **Privileges stay inside the catalog.** A module cannot invent a new
  privileged action; it can only request operations that already exist in the
  broker's closed catalog, which is itself reviewed code.

**This is a commitment to diligence, not a guarantee of perfection.** Review
can miss things, and the right to be wrong is reserved explicitly. In
particular:

> **You are responsible for your own data and for what you choose to run.**
> Keep backups. POSMA performs destructive operations at your instruction —
> deleting files, removing packages, editing boot configuration — and while
> it is built to preview first and fail safe, the consequences of confirming
> an action are yours.
>
> **Third-party and self-installed modules are entirely at your own risk.**
> Anything you install from outside official distribution has not been
> reviewed by the author, may do anything the system permits it to do, and
> carries no assurance of any kind.

This sits alongside — and does not narrow — the warranty disclaimer in the
[license](LICENSE.md).

## Author and ownership

POSMA is created, owned and maintained by **Kosma (KosmaBB)**, sole author
and sole copyright holder.

All rights to the project, its name and its source are reserved by the
author. Contributions are welcome under the terms in
[Contributing](#contributing), and commercial licensing is arranged directly
with the author — see [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

## Website

Planned home: **posma.com** / **posma.pl**

Neither domain is live yet — `.com` is a significant purchase and `.pl` is
currently registered to someone else, so acquiring them is pending. Until
then this repository is the only official source of POSMA. Treat any other
site distributing something called POSMA as unaffiliated.

The site will host downloads, the custom-module directory, documentation and
a link back here.

## Licensing

POSMA's source is published in full and dual-licensed, on the model WinRAR
popularised:

- **Free** for private individuals, research, education, charities and public
  bodies — under [PolyForm Noncommercial 1.0.0](LICENSE.md).
- **Paid** for companies and commercial use — see
  [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

**Free commercial licences are granted at the author's discretion.** Companies
and public or state institutions can arrange free use of the paid tier by
agreeing it with the author in advance — for evaluation, for schools and
similar institutions, or simply where it makes sense. It is a grant, not an
entitlement: ask first, and it applies once agreed.

To be precise about terms: this is **source-available**, not "open source" in
the [OSI](https://opensource.org/osd) sense, because that definition forbids
restricting commercial use. Everything is readable, auditable and modifiable;
companies are simply expected to pay for commercial use.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md)
for the full guide, and [SECURITY.md](SECURITY.md) for reporting anything
exploitable privately. Two ground rules, both non-negotiable because of what
this software does:

1. **No new privileged behaviour outside the broker catalog** — no `sudo`,
   `pkexec` or shell-out-as-root inside a module, however tightly scoped it
   looks.
2. **Anything destructive gets a preview first, and validation on the
   privileged side**, independent of whatever the UI already checked.

By contributing you agree your contributions are licensed under the same
dual-license terms as the project.
