# Security model

This document exists to be checked against the code, not taken on faith. It
describes what can reach administrator rights, what stops it, and — just as
importantly — what is **not** protected.

## The one-sentence version

Nothing except a small, closed set of reviewed operations can run with
administrator rights, and the code holding those rights re-derives its own
safety checks rather than trusting anything below it.

## Privilege boundaries

| Component | Runs as | Can it reach root? |
|---|---|---|
| React UI | the user, in a webview | No |
| Core (`core/src-tauri`) | the user | Only by asking the broker |
| Modules (`modules/*`) | the user | **No** — never, by design |
| Broker (`*-broker`) | root | It *is* the privileged component |

A module cannot elevate. It has no `sudo`, no `pkexec`, no setuid path. When
a module hits a permission wall it reports the failure honestly — that's the
intended behaviour, not a bug. The privileged half of such a feature is a
separate broker operation invoked by the core.

This rule has been enforced against real pressure: when the temp-cleaning
module couldn't truncate system logs, adding a narrow one-off `pkexec` call
would have fixed it immediately, and was deliberately not done.

## The closed operation catalog

Everything the broker can do is a variant in one Rust enum
(`crates/broker-common/src/ops.rs`). There is **no** operation that takes a
command, a script, or an arbitrary path to execute.

Consequences worth stating plainly:

- A compromised or buggy UI cannot ask the broker to do something new. The
  worst it can do is call an existing, reviewed operation with bad
  arguments — which each operation validates itself.
- Adding a privileged capability is a code change to a reviewed file, not a
  configuration change.
- Unknown operations are rejected by the deserializer, before any logic runs.

Verified behaviour:

```
$ echo '{"op":"run_arbitrary_command","cmd":"rm -rf /"}' | linux-broker
{"ok":false,"error":"invalid request: unknown variant `run_arbitrary_command`, …"}
```

## The broker does not trust the layers below it

Every operation re-validates its own inputs and re-derives its own safety
conditions inside the root process, even when the unprivileged side already
checked. The kernel-removal operation is the clearest example:

- re-runs `uname -r` itself to find the running kernel, and refuses it;
- re-reads the `/boot/vmlinuz` symlink itself to find the newest kernel, and
  refuses it;
- **refuses outright if it cannot determine either** — an unreadable value is
  treated as "unsafe", never as "fine".

That last point is the general rule: **fail closed under uncertainty.** It
matters more than it sounds. Both kernel guards originally used
`.unwrap_or_default()`, which turns a failure into an empty string that
compares unequal to everything — silently disabling both protections on any
system where those values couldn't be read. That was found and fixed in a
review; it is exactly the kind of defect this rule exists to prevent.

## Destructive changes are reversible

System configuration writes go through one shared pipeline
(`guards::write_with_backup`), never a direct write:

```
backup + rotate → atomic write → verify → on failure: restore + re-verify
```

If verification fails (on Linux, `update-grub` refusing the new config), the
previous content is restored and re-verified from the known-good state before
the original error is reported. A bad edit cannot leave the system holding a
configuration that won't regenerate.

Backup retention is configurable, defaulting to the two most recent.

## Shared guards, and why each exists

These live in `crates/broker-common/src/guards.rs` so there's one place for
the rule rather than a copy per module that can drift:

| Guard | Prevents |
|---|---|
| `is_safe_package_id` | A name starting with `-` being read as a *flag* by apt/snap/winget/brew. Arguments aren't shell-interpreted, so injection isn't the risk — flag smuggling is. |
| `contained_in` | Targeting a whitelist root *itself*. `Path::starts_with` is also true for an equal path, so without the `!=` half a request naming `~/Downloads` passes an "inside the allowed area" check and takes the whole tree. |
| `is_same_file` / `copy_dir_recursive` | Self-copy truncation. `fs::copy` opens the destination for writing (truncating it) *before* reading the source; if they're the same file, the content is destroyed with nothing left to copy back. |
| `write_atomic` | A partial write leaving a truncated original when interrupted. |
| `backup_and_rotate` / `write_with_backup` | Unrecoverable configuration edits. |

Two of these were written in response to defects that actually occurred, not
hypotheticals. The self-copy guard in particular exists because a theme
install whose source and destination resolved to the same directory zeroed
around 80 real files on a live machine.

## Permission gating

Capabilities are a closed list (`fs-user`, `fs-system`, `fs-scan`, `pkg`,
`svc`, `autostart-user`, `autostart-system`, `boot`, `disk-smart`,
`restore-point`, `fda`, `secrets`, `net`), defined once in
[`access/catalog.json`](../access/catalog.json). The Rust core embeds that
file at compile time and the interface imports the same one, so the thing
enforcing permissions and the thing describing them to you cannot disagree.
They used to be separate hand-maintained copies, and they had drifted.

The catalog also records which capabilities each module may request and
which module owns each privileged operation. Every privileged command calls
`PermissionRegistry::require_operation(...)`, which refuses unless **both**
hold:

1. the catalog says the operation's module declares the capability it needs;
2. the user has granted that capability.

The first check is what stops a granted capability from being a skeleton
key. Granting `boot` lets the GRUB editor write the boot configuration; it
does not let a module that never declared `boot` do the same. An operation
the catalog does not describe is refused outright rather than waved through.

Each module also carries its own `module.json`, because a module has to
stand on its own — a third-party one ships with a manifest and the catalog
knows nothing about it. `cargo test -p core` checks every manifest on disk
against the catalog, so the two accounts cannot drift.

**Access levels** decide how long a grant lasts. Under full access, consent
was given in bulk at onboarding with the whole list visible, so grants are
recorded and survive a restart. Under selective access, anything needing
elevation is granted for the current run only and is asked for again next
time. Tightening from full to selective drops session grants immediately.
The level lives in the core's own state file rather than only in the
interface, because how long a privileged grant lasts is not a decision to
leave somewhere the user can edit with a browser console.

## What is *not* protected

Being specific here is more useful than reassurance:

- **You, confirming a destructive action.** POSMA previews first and asks,
  but if you confirm deleting files or removing a package, it does that.
  Keep backups.
- **Modules you install yourself, from outside official distribution.** They
  are unprivileged like any module, but within your user account they can do
  whatever your account can. They have not been reviewed by anyone.
- **A compromised user account.** POSMA's boundary is user-versus-root. It
  does not defend against something already running as you.
- **The daemon, if installed by the wrong user.** Access is granted to the
  user ID recorded at install time. Installing it while acting for another
  account grants it to that account.
- **Windows daemon mode.** It doesn't exist. Windows uses per-action
  elevation only.
- **macOS and Windows brokers generally.** They are written but have never
  run on real hardware. Treat them as unreviewed until that changes.

## Module review policy

For modules distributed through official channels (planned for 1.0):

- no external scripts — a module does not download, generate or execute code
  from elsewhere;
- no fetching external files, scripts or code at runtime;
- review before publication and on every update, including declared
  capabilities;
- privileges stay inside the catalog — a module cannot invent a privileged
  action, only request an existing reviewed operation.

This is a commitment to diligence, not a guarantee. Review can miss things.
The right to be wrong is reserved explicitly, and responsibility for your
data, your confirmed actions and any third-party modules you install remains
yours — see the [README](https://github.com/KosmaBB/Posma/blob/master/README.md#module-security) and the warranty
disclaimer in the [license](https://github.com/KosmaBB/Posma/blob/master/LICENSE.md).

## Reporting a security issue

Email **kosma.brzezawski@gmail.com** with enough detail to reproduce. Please
don't open a public issue for something exploitable until it's fixed.
