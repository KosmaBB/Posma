# Architecture

POSMA is three layers with deliberately different privilege levels, talking
over one protocol.

```
┌──────────────────────────────────────────────┐
│ UI            React, in a Tauri webview      │  no system access
└───────────────────┬──────────────────────────┘
                    │ Tauri commands (invoke)
┌───────────────────┴──────────────────────────┐
│ Core          Rust, core/src-tauri           │  runs as the user
│               routing, permission registry   │
└──────┬─────────────────────────┬─────────────┘
       │ one-line JSON           │ one-line JSON
┌──────┴──────────────┐   ┌──────┴─────────────┐
│ Modules             │   │ Broker             │  runs as root
│ modules/*           │   │ modules/*-broker   │
│ run as the user     │   │ closed op catalog  │
└─────────────────────┘   └────────────────────┘
```

## Core (`core/`)

A Tauri app: Rust backend in `core/src-tauri`, React UI in `core/src`.

The core holds no privileged code of its own. Its jobs are routing UI
requests to the right module, holding the permission registry
(`permissions.rs` — which capabilities the user has granted, persisted to
`permissions.json` in the app data directory), and being the only thing that
talks to the broker.

The UI never reaches a module or the broker directly — everything goes
through a Tauri command, which is where capability gating happens
(`PermissionRegistry::require`).

## Modules (`modules/`)

One crate per feature. Each builds to a standalone executable that
`scripts/sync-sidecars.sh` copies into the app bundle, where Tauri launches
it as a *sidecar*.

**Modules are unprivileged.** They run as the user, with no elevation of any
kind. A module that needs something privileged doesn't get it — it returns an
honest error, and the privileged half of the feature is a separate broker
operation the core invokes.

The protocol is deliberately minimal: **one JSON line in on stdin, one JSON
line out on stdout, then exit.**

```json
{"cmd":"scan"}
{"ok":true,"data":{"total_bytes":423336032}}
```

Spawn-per-request rather than a long-lived daemon, because it's much harder
to get wrong: no shared state to leak between calls, no process to leave
running, and a crashed module can't take anything with it.

**One exception:** `modules/vault` is long-lived, because it holds a derived
encryption key in memory and re-deriving it (Argon2id) or re-prompting for
the master password on every action would be both slow and worse for the
user. It is started explicitly, stopped explicitly, and is the only module
with that shape.

## Brokers (`modules/{linux,macos,windows}-broker`)

The only components that run as root, and the smallest ones by design — the
security argument only holds if this code is small enough to actually read.

All three share `crates/broker-common`, which holds:

### The other shared crates

Two more crates exist for the same reason: a rule that lives in one module
is not a rule.

- **`scan-filter`** — what a disk scanner may show. Three modules walk the
  filesystem looking for things to delete; a file hidden by one and offered
  by another would make the exclusion meaningless. It separates *blocked*
  (another system's volume, the running system, the user's own list) from
  *noise* (games, dependency trees) because a disk map must count the second
  and hide neither the first.
- **`sysmetrics`** — readings the machine gives up without privilege:
  temperatures from hwmon, graphics cards from sysfs or `nvidia-smi`. Adding
  a source is one function returning a list; the dashboard and the health
  monitor both pick it up without being edited. Anything needing root stays
  out of it — that is what the broker is for, and why S.M.A.R.T. is not here.

- **the closed operation catalog** (`ops.rs`) — a Rust enum of every
  permitted privileged operation across all OSes. There is no
  "run arbitrary command" variant. An unrecognised operation is rejected by
  the deserializer before reaching any logic.
- **the `Broker` trait** (`broker.rs`) — one method per operation, each
  defaulting to an honest "not supported on this system". A new OS broker
  compiles and answers every operation correctly before a single operation is
  implemented; each one lands by overriding one method.
- **shared guards** (`guards.rs`) — path containment, package-name
  validation, same-file detection, backup rotation, atomic writes. Each of
  these exists because something went wrong without it (see
  [Security model](security-model.md)).
- **dispatch and transports** (`serve.rs`) — one request handler, used by
  every run mode, so no transport can diverge in what it actually does.

Each per-OS broker implements only what it can genuinely do on that platform
and reports the rest as unsupported. `capabilities` is itself an operation,
so the UI can ask what's available rather than discovering it by failing.

### Two ways the broker is reached

| Mode | How | Trade-off |
|---|---|---|
| One-shot | Core spawns the broker binary through the OS elevation prompt (`pkexec` on Linux) per action | No installation, prompts every time |
| Daemon | An installed helper holds a Unix socket; core connects to it | One installation, then no prompts |

The daemon's access control is the connecting process's **verified user ID**
(`SO_PEERCRED`), checked before a single byte of the request is read — not
socket file permissions. If it can't identify its owner it refuses to start.

Windows has no daemon mode: the equivalent (named pipe plus
`GetNamedPipeClientProcessId`) is security-critical code that hasn't been
written on a machine where it can be tested, so it's deliberately absent
rather than guessed at.

## Why this shape

The alternative — one binary running elevated, with features as internal
modules — would be smaller and simpler to build. It was rejected because it
makes two of the project's promises impossible:

1. **Auditability.** If everything runs elevated, "read the privileged code"
   means reading the whole application. Here it means reading one small
   crate plus one per-OS file.
2. **Real removal.** If features are compiled in, uninstalling one can only
   ever mean hiding it. Separate executables mean removal can delete a file.

The cost is process-spawn overhead per action and a protocol to maintain.
For a maintenance tool that acts in response to a click, that's cheap.
