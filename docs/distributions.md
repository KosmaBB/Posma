# Linux distributions

*[Polska wersja →](pl/distributions.md)*

POSMA was written on Ubuntu, and for a long time that showed: four of the
seven Linux modules assumed apt and dpkg, `update-grub` and a
`/boot/vmlinuz` symlink. This page says where it runs now, what was
actually run to find out, and what was not.

## How support works

By family, not by name. The twenty-odd distributions people actually
install reduce to four package managers, and a derivative announces its
parent in `/etc/os-release` (`ID_LIKE`). The shared `distro` crate reads
that, and the unprivileged modules and the root broker both ask it — so
they cannot disagree about what kind of system this is.

| | apt | pacman | dnf | zypper | image-based | anything else |
|---|---|---|---|---|---|---|
| | Debian, Ubuntu, Mint, Pop!_OS, Zorin, MX, elementary, Kali, KDE neon | Arch, CachyOS, Manjaro, EndeavourOS, Garuda | Fedora, Nobara, RHEL, AlmaLinux, Rocky | openSUSE | Bazzite, SteamOS, Silverblue | NixOS, Void, Alpine, Gentoo |
| The nine cross-platform modules | yes | yes | yes | yes | yes | yes |
| Package caches, orphans | yes | yes | yes | yes | says why not | says why not |
| Uninstaller — system packages | yes | yes | yes | yes | — | — |
| Uninstaller — Flatpak, snap, leftovers | yes | yes | yes | yes | yes | yes |
| Kernel versions — list | yes | yes | yes | yes | — | — |
| Kernel versions — remove | yes | no¹ | yes | no² | — | — |
| GRUB editor | `update-grub`, `/boot/grub` | `grub-mkconfig`, `/boot/grub` | `grub2-mkconfig`, `/boot/grub2` | `grub2-mkconfig`, `/boot/grub2` | says why not | where GRUB and its tools exist |
| systemd journal | where systemd is the init | yes | yes | yes | yes | says why not |

¹ Each kernel package holds exactly one version and an update replaces it,
so nothing accumulates.
² openSUSE purges old kernels itself after a reboot.

"Says why not" is literal: the module opens and states the reason in one
sentence. Where a feature does not exist on a system, POSMA says so rather
than showing an empty list or a button that fails.

An image-based system is recognised by `/run/ostree-booted` or by `/usr`
being mounted read-only. Its packages belong to the image, so POSMA does
not offer to remove them — Flatpak, which is how applications are meant to
be installed there, works as everywhere.

## What POSMA asks at first start

The family is one of four things the `distro` crate works out. The others
are the desktop, read from `XDG_CURRENT_DESKTOP`, and the boot loader, read
first from the `LoaderInfo` EFI variable the loader itself sets
(systemd-boot, Limine, and GRUB where it is built with `bli`, as on Fedora)
and only then from files on disk. The last is whether systemd runs as init.

The first screen after consent shows all of it — "CachyOS · based on: arch
· pacman · KDE Plasma · Limine" — and asks whether it is right. Anything
corrected there, or later in Settings, is stored by the core and given to
every module it starts as `POSMA_PKG_MANAGER`, `POSMA_DESKTOP` and
`POSMA_BOOTLOADER`. What changes with it:

| | |
|---|---|
| Desktop personalisation | Named after the desktop, and drives that desktop's own settings: GNOME's keys for GNOME, Budgie and Pantheon, Cinnamon's and MATE's forks of them, `xfconf-query` for Xfce, `kwriteconfig` for Plasma. LXQt, COSMIC and window managers are named and left alone. |
| Boot editor | Opens for the loader that boots the system: GRUB's full editor, or default entry and timeout for Limine, systemd-boot and rEFInd. GRUB's files can outlive a switch to Limine, and editing them would change nothing. |
| Package modules | Named after their manager; install hints use its command. |
| Journal | Says why not where systemd is not the init. |

The family can only be chosen where the system does not declare one. A
family `os-release` names, whose tool is installed, is a fact the root
broker acts on too — so the user's answer cannot make a module list pacman
packages for a broker that will run apt.

## What was run, and where

Three kinds of evidence, which are not the same thing:

- **Real machine** — the app used on an installed system.
- **Container** — the modules and the broker run inside a container of
  that distribution, against its real package manager, including the
  destructive paths: a package is removed, orphans are swept, the cache is
  emptied, an old kernel is taken out.
- **Stand-in** — the distribution publishes no container image, so the
  image it is built from is used, announcing itself in `os-release` the way
  the derivative does. This checks detection on the right userland. It is
  not that distribution.

What no container shows, for any row below: a boot through a regenerated
GRUB menu, the polkit password prompt, the window itself, the installed
broker daemon, and the credential store the vault keeps its key in.

| Distribution | Family | Evidence | Also run there |
|---|---|---|---|
| Ubuntu 24.04 | apt | real machine; container | kernels, GRUB, build |
| Ubuntu 26.04 | apt | container | build |
| CachyOS | pacman | container; the window itself, under a virtual display | kernels, GRUB, build |
| Linux Mint 22.3 | apt | container | |
| Debian 13 | apt | container | kernels, GRUB, build |
| Fedora 44 | dnf | container | kernels, GRUB, build |
| Arch Linux | pacman | real machine: the app starts, modules not yet tried one by one; container | build |
| Manjaro | pacman | container | |
| openSUSE Tumbleweed | zypper | container | kernels, GRUB, build |
| elementary OS | apt | container | |
| Kali | apt | container | kernels (one version only), GRUB |
| SteamOS | image-based | container of its base image, read-only | |
| NixOS | none | container of the Nix userland, not an installed NixOS | |
| MX Linux | apt | stand-in on Debian 13 | |
| Pop!_OS | apt | stand-in on Ubuntu 24.04 | |
| Zorin OS | apt | stand-in on Ubuntu 24.04 | |
| KDE neon | apt | stand-in on Ubuntu 24.04 | |
| EndeavourOS | pacman | stand-in on Arch | |
| Garuda | pacman | stand-in on Arch | |
| Nobara | dnf | stand-in on Fedora 44 | |
| Bazzite | image-based | stand-in on Fedora 44, read-only | |
| **Servers** | | | |
| Ubuntu Server 22.04 | apt | container | build |
| Debian 12 | apt | container | kernels, GRUB, build |
| AlmaLinux 9 (RHEL 9) | dnf | container | kernels, GRUB; **the window cannot be built** |
| Rocky Linux 10 (RHEL 10) | dnf | container | build, with EPEL |
| **Outside the four families** | | | |
| Void, Alpine | none | container | |

The twenty home distributions were picked from DistroWatch's page-hit
ranking and the Steam hardware survey of September 2026. Neither counts
installations; they are the nearest thing to a list there is.

## Things worth knowing per distribution

**CachyOS.** The installer offers several boot loaders and GRUB is only one
of them. With Limine, systemd-boot or rEFInd the boot editor sets the
default entry and the timeout only — GRUB's themes have no counterpart there.
Limine's `limine.conf` is re-sealed with `limine-enroll-config` after every
change, as limine-entry-tool expects; on this distribution's default it
only re-signs where Secure Boot keys exist. The default desktop is KDE Plasma; desktop personalisation
reads its settings correctly on a Plasma 6 session, and applying them has
not been tried there yet. Kernel versions lists `linux-cachyos` and its
siblings but has nothing to remove.

**Arch-based systems on a rolling release.** Emptying the package cache
also discards the previous versions a failed update would be rolled back
to. The confirmation says so.

**Pop!_OS** boots through systemd-boot: the boot editor sets its default
entry and timeout.

**MX Linux** starts with SysVinit unless told otherwise. Without systemd
there is no journal to trim and the broker daemon cannot be installed;
every privileged action asks through `pkexec` instead, which is the same
path a fresh install uses anywhere.

**Fedora and its family.** GRUB themes only display with
`GRUB_TERMINAL_OUTPUT="gfxterm"`; Fedora ships `console`, so installing a
theme switches that one line. A `GRUB_TERMINAL=console` set by hand still
wins and is left alone. Kernels are not in `grub.cfg` there but in
`/boot/loader/entries`, one file each; the list of boot entries reads them
from there.

**Choosing the default entry.** On Debian, Ubuntu and openSUSE every kernel
but the newest sits in an "Advanced options" submenu, and GRUB only finds
such an entry by its full path. The list offers it as
`Advanced options for Ubuntu>Ubuntu, with Linux …` — given the bare title,
GRUB would quietly boot the first entry instead.

**Bazzite, SteamOS** and other image-based systems: see above.

**NixOS, Void, Alpine, Gentoo.** The app's own package modules do not
drive nix, xbps, apk or portage, and say so. Everything that works on a
user's own files does.

**Servers.** POSMA is a desktop application: it needs a graphical session,
WebKitGTK 4.1 and polkit with an authentication agent. On RHEL 9 and its
rebuilds the modules and the broker run, but the window cannot be built:
only WebKitGTK 4.0 is packaged there, in the distribution and in EPEL
alike. RHEL 10 has 4.1 in EPEL. Ubuntu Server and Debian have it.

## A build made on one distribution, run on another

A binary built on Ubuntu 24.04 needs glibc 2.39 and will not start on
anything older — on AlmaLinux 9 it stops at the loader:

```
/lib64/libc.so.6: version `GLIBC_2.39' not found
```

So a build travels forward, not back: built here, it runs on Debian 13,
Fedora, Arch and their families, and not on Debian 12, Ubuntu 22.04 or
RHEL 9. Built from source *on* each of those, it is fine.

This is why the release workflow builds the Linux packages on Ubuntu
22.04: a release has to be built on the oldest system it is meant to
support, not on whatever the development machine happens to run — and a
rolling distribution is the newest there is.

## Running the checks

```bash
rustup target add x86_64-unknown-linux-musl   # once
bash scripts/distro-check.sh                  # every distribution
bash scripts/distro-check.sh --kernels --grub cachyos fedora
bash scripts/distro-check.sh --build debian
```

It builds the modules once as static binaries, so the same files run on
every image whatever its C library, and starts a container per
distribution. Images it pulled are removed again as it goes.

A distribution is added by adding one row to the table at the top of the
script. If it belongs to a family already listed, nothing else changes.
