# access/

`catalog.json` is the single source of truth for the permission system.

Before this directory existed, the same facts were written down in four
places — the Rust catalog, the TypeScript catalog, each module's
`module.json`, and the module list in the interface — and they had already
drifted apart. Five modules were listed in the interface as requesting
capabilities their own code explicitly does not use.

## What is in it

| Section | Answers |
|---|---|
| `capabilities` | What can be asked for at all, what it means in plain language, and whether it needs elevation |
| `modules` | Which capabilities each module is allowed to request |
| `operations` | Which privileged operation belongs to which module, and what it costs |

## Who reads it

- **Rust** — embedded at compile time with `include_str!`, so a malformed
  catalog fails the build rather than the application.
- **TypeScript** — imported directly. The interface never restates a
  capability; it looks it up.
- **Tests** — `cargo test -p core` checks the catalog against every
  `module.json` on disk, so a module and the catalog cannot disagree.

## Changing it

Adding a capability to a module means editing two files: this catalog and
that module's `module.json`. The test suite fails if you edit only one.

That duplication is deliberate. A module's manifest has to stand on its own,
because a module written by somebody else ships with one and the catalog
knows nothing about it — the catalog covers the modules that come with
POSMA, and the check keeps those two accounts honest.

## Why a module declares anything at all

The core refuses a privileged operation whose module never declared the
capability it needs, whatever the user has granted. Granting `boot` gives
the GRUB editor permission to touch the boot configuration; it does not give
it to a module that never asked for it.
