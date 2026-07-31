# Writing a module

A module is a standalone executable that reads one JSON request from stdin,
writes one JSON response to stdout, and exits. That's the whole contract.

## Minimum viable module

`modules/my-module/Cargo.toml`:

```toml
[package]
name = "my-module"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "my-module"
path = "src/main.rs"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

`modules/my-module/module.json`:

```json
{
  "id": "my-module",
  "name": "Nazwa widoczna w aplikacji",
  "description": "What it does, and honestly what it does not",
  "version": "0.1.0",
  "platforms": ["linux"],
  "binary": "my-module",
  "capabilities": ["fs-user"]
}
```

`capabilities` lists only what the module's **current code actually uses** —
not what it might want later. It's a claim that gets reviewed.

`src/main.rs` follows the shape every existing module uses: a
`#[serde(tag = "cmd")]` request enum, an untagged response enum, and a `main`
that reads one line and prints one line. Copy the smallest existing module
(`modules/system-info`) as a starting point rather than writing it from
scratch.

## Wiring it up

1. **Register the crate** — the workspace already globs `modules/*`, so no
   root `Cargo.toml` change is needed.
2. **Add a core command** in `core/src-tauri/src/lib.rs`:

   ```rust
   #[tauri::command]
   async fn scan_my_thing(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
       call_sidecar(&app, "my-module", serde_json::json!({ "cmd": "scan" })).await
   }
   ```

   …and add it to the `invoke_handler!` list.
3. **Build and sync**: `bash scripts/sync-sidecars.sh`
4. **Add it to `externalBin`** in `core/src-tauri/tauri.conf.json` — *after*
   the binary exists, or the Tauri build fails with
   `resource path ... doesn't exist`.
5. **Add a catalog entry** in `core/src/data/modules.ts` (folder, supported
   OSes, risk level, capabilities).
6. **Add a view** in `core/src/views/modules/` and register it in
   `MODULE_VIEWS` in `ModuleView.tsx`.

## Rules that are not negotiable

**No elevation inside a module.** No `sudo`, no `pkexec`, no setuid, no
"just this once" exception however tightly scoped. If your module needs
root, the privileged part belongs in the broker as a new catalogued
operation, and the module reports an honest error without it. See
[Security model](security-model.md).

**Preview before destruction.** Scanning and acting are separate commands.
The user sees what will happen and confirms; the module never scans-and-acts
in one call.

**Re-validate on the acting side.** Don't trust that the paths coming back
in a `clean` request are the ones you returned from `scan`. Re-check them
against your whitelist. State can change between the two calls, and the
request isn't guaranteed to be the one you produced.

**Fail closed when unsure.** If you can't determine whether something is safe
to touch, refuse. Never let an unreadable value become a default that
disables a check — that specific mistake has already been made in this
codebase and shipped a real hole.

**Never follow symlinks when deleting.** Operate on the link itself. Resolve
the *parent* directory for containment checks, not the target path.

**Be honest about limits.** If a feature only works on some setups, say so in
the description and in the UI. A module that quietly does less than it claims
is worse than one that says it can't.

## Per-OS logic

A module keeps **one crate, one binary name and one protocol** on every
system. What changes underneath is an implementation detail the frontend and
`module.json` never see.

How to split depends on how far the systems actually diverge.

### Different paths or strings — branch inline

`cfg!(target_os = "…")` is an ordinary runtime boolean. Every branch is
compiled on every platform, so it only works when all branches *can* compile
everywhere — different directories, different command names, different
defaults. That is how the existing cross-platform modules handle it:

```rust
let cache_root = if cfg!(target_os = "macos") {
    home.join("Library/Caches")
} else {
    home.join(".cache")
};
```

### Different mechanisms — split into files

The moment an implementation needs an API, a crate or a command that does not
exist on the other systems, `cfg!` stops working: the code still has to
compile everywhere, and it cannot. Use the `#[cfg]` *attribute* instead, which
removes non-matching code before compilation, and give each system its own
file behind a shared trait:

```
modules/<name>/src/
  main.rs         protocol, dispatch, shared types — no OS branching
  platform/
    mod.rs        the trait, and the cfg-selected re-export
    linux.rs
    macos.rs
    windows.rs
```

```rust
// platform/mod.rs
pub trait Platform {
    fn scan(&self) -> ScanResult;
    fn clean(&self, paths: Vec<String>) -> CleanResult;
}

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::Impl as Current;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::Impl as Current;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::Impl as Current;
```

`main.rs` then talks only to `Current`, and never mentions an operating
system. This is the same shape `crates/broker-common` uses for the per-OS
brokers, for the same reason.

**Rule of thumb:** a different *location* is a branch; a different *mechanism*
is a file. Scheduling is the clearest example — systemd timers, `launchd` and
Task Scheduler have nothing in common but the intent.

### Keep the protocol identical

The response shape must not vary by system, or the frontend ends up with a
branch per platform and the module stops being one module.

Where a system genuinely cannot do something the others can, **say so in the
response** rather than silently doing less — the same honesty rule the broker
follows with `not_supported`. A field that is always empty on one platform is
better than a field that means something different there.

### Declare only what the current system needs

`module.json` lists `platforms` and `capabilities` for the module as a whole.
If one system's implementation needs elevation and another's does not, that
difference belongs in the description, so nobody reading the manifest assumes
the privileged path is used everywhere.

## Path safety

For anything under the user's home, the pattern used throughout is: resolve
the parent, join the filename, and require containment **strictly inside** an
allowed root:

```rust
let inside = path.parent()
    .and_then(|p| p.canonicalize().ok())
    .map(|parent| {
        let full = parent.join(path.file_name().unwrap_or_default());
        roots.iter().any(|root| root.canonicalize()
            .map(|r| full.starts_with(&r) && full != r)   // != r is load-bearing
            .unwrap_or(false))
    })
    .unwrap_or(false);
```

The `full != r` half stops a request naming the root itself from taking the
entire tree. It was missing in four modules at once — don't drop it.

Resolving the *parent* rather than the path is deliberate too: the target may
be a symlink you intend to unlink, or may not exist yet.

## Adding a privileged operation

If the feature genuinely needs root:

1. Add a variant to the catalog in `crates/broker-common/src/ops.rs`.
2. Add a defaulted method to the `Broker` trait in `broker.rs`.
3. Add the dispatch arm in `handle_line`.
4. Implement it in each OS broker that can honour it, and list it in that
   broker's `implemented_ops()`.
5. Add a core command gated by `PermissionRegistry::require(...)`.

Validate inputs **inside the broker**, independently. Reuse
`guards::is_safe_package_id`, `guards::contained_in`,
`guards::is_same_file` — they exist because each one prevented (or failed to
prevent, once) a real defect.

Never add a generic passthrough operation. The closed catalog is the security
model; an operation that takes a command to run defeats all of it.

## Testing

Talk to the module directly — it's just a process:

```bash
echo '{"cmd":"scan"}' | ./target/debug/my-module | python3 -m json.tool
```

Test rejection paths (bad input, paths outside the whitelist, malformed
requests) against the real binary. **Do not** run destructive success paths
against your own machine to "check they work" — verify those by reading the
code, or on a disposable system.
