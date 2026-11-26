# POSMA documentation

*[Polska wersja →](pl/)*

Developer and reviewer documentation. If you're here to understand what POSMA
does with administrator rights before trusting it, start with
[Security model](security-model.md) — that's the document written for exactly
that question.

| Document | What it covers |
|---|---|
| [Architecture](architecture.md) | How core, modules and brokers fit together, and why it's split that way |
| [Security model](security-model.md) | The privilege model in full: what can reach root, what stops it, and what is *not* protected |
| [Writing a module](writing-a-module.md) | The module contract — protocol, manifest, capabilities, safety rules |
| [Writing a theme](writing-a-theme.md) | Your own look for the whole app: language, variable names, the starter template, the rules |
| [Writing a translation](writing-a-translation.md) | POSMA in your language: the file format, plural forms, the template, the check |
| [Building and development](building.md) | Toolchain, build order, the sidecar sync step, testing, installers |
| [Linux distributions](distributions.md) | Which distributions POSMA runs on, what each module does there, and what was actually run to find out |

The documentation exists in English and in [Polish](pl/). If the two
ever disagree, the code decides — and the difference is worth reporting like
any other bug. The user-facing README exists in both too:
[English](https://github.com/KosmaBB/Posma/blob/master/README.md) and [Polish](https://github.com/KosmaBB/Posma/blob/master/README.pl.md).

## Design documents

One longer-form document lives at the repository root and is the origin of
much of what's described here:

- [`Access_plan.md`](https://github.com/KosmaBB/Posma/blob/master/Access_plan.md) — the permission/capability
  system design (Polish). Section §3 holds the module × capability × OS
  matrix, §4 the broker design, §6 the implementation order. Referenced by
  name throughout the source.

## Policy documents

These live at the repository root and exist in both English and Polish:

- Security policy — [English](https://github.com/KosmaBB/Posma/blob/master/SECURITY.md) · [polski](https://github.com/KosmaBB/Posma/blob/master/SECURITY.pl.md)
- Contributing guide — [English](https://github.com/KosmaBB/Posma/blob/master/CONTRIBUTING.md) · [polski](https://github.com/KosmaBB/Posma/blob/master/CONTRIBUTING.pl.md)
- Licence — [binding text](https://github.com/KosmaBB/Posma/blob/master/LICENSE.md), explained in [English](https://github.com/KosmaBB/Posma/blob/master/COMMERCIAL-LICENSE.md) and [polski](https://github.com/KosmaBB/Posma/blob/master/COMMERCIAL-LICENSE.pl.md)

## A note on accuracy

These documents describe what the code does *today*, including where it falls
short. Where something is planned but not built, it says so. If you find a
place where the documentation claims more than the code delivers, that's a
bug worth reporting — the whole point of this project is that its claims are
checkable.
