# POSMA documentation

Developer and reviewer documentation. If you're here to understand what POSMA
does with administrator rights before trusting it, start with
[Security model](security-model.md) — that's the document written for exactly
that question.

| Document | What it covers |
|---|---|
| [Architecture](architecture.md) | How core, modules and brokers fit together, and why it's split that way |
| [Security model](security-model.md) | The privilege model in full: what can reach root, what stops it, and what is *not* protected |
| [Writing a module](writing-a-module.md) | The module contract — protocol, manifest, capabilities, safety rules |
| [Building and development](building.md) | Toolchain, build order, the sidecar sync step, testing |

Docs are written in English so they stay usable for contributors who don't
read Polish; the user-facing README exists in both
[English](https://github.com/KosmaBB/Posma/blob/master/README.md) and [Polish](https://github.com/KosmaBB/Posma/blob/master/README.pl.md).

## Design documents

One longer-form document lives at the repository root and is the origin of
much of what's described here:

- [`Access_plan.md`](https://github.com/KosmaBB/Posma/blob/master/Access_plan.md) — the permission/capability
  system design (Polish). Section §3 holds the module × capability × OS
  matrix, §4 the broker design, §6 the implementation order. Referenced by
  name throughout the source.

## A note on accuracy

These documents describe what the code does *today*, including where it falls
short. Where something is planned but not built, it says so. If you find a
place where the documentation claims more than the code delivers, that's a
bug worth reporting — the whole point of this project is that its claims are
checkable.
