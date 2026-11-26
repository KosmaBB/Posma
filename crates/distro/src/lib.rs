//! What kind of Linux this is, in one place.
//!
//! The Linux modules were written on Ubuntu and each assumed it: apt and
//! dpkg, `update-grub`, a `/boot/vmlinuz` symlink. This crate holds the
//! three facts that differ between distributions — the native package
//! manager, how kernels are packaged, and where GRUB keeps its files — so
//! an unprivileged module and the root broker cannot disagree about them.
//!
//! Detection is by family, not by name. Twenty-odd popular distributions
//! reduce to four package managers; a derivative nobody listed still works
//! as long as it says which family it descends from.
//!
//! Every command and parser here was run against the real tool in a
//! container of that family before it was written down — see
//! `scripts/distro-check.sh`, which repeats that on demand.

use std::cmp::Ordering;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Manager {
    Apt,
    Pacman,
    Dnf,
    Zypper,
}

/// A command for the privileged side to run. `stdin` exists for the one
/// tool that cannot be told "yes" any other way.
pub struct Cmd {
    pub argv: Vec<String>,
    pub stdin: &'static str,
}

fn cmd(parts: &[&str]) -> Cmd {
    Cmd { argv: parts.iter().map(|s| s.to_string()).collect(), stdin: "" }
}

/// Looks beyond `PATH` because an ordinary Debian account does not have
/// the sbin directories on it, and that is where the GRUB tools live. An
/// app started from the macOS Finder has no Homebrew on its PATH either,
/// whose prefix is /opt/homebrew on Apple silicon and /usr/local on Intel.
/// That prefix belongs to the user — no root process may run from it, and
/// on macOS none uses this crate.
pub fn find_program(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let homebrew: &[&str] =
        if cfg!(target_os = "macos") { &["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/local/sbin"] } else { &[] };
    std::env::split_paths(&path)
        .chain(homebrew.iter().map(PathBuf::from))
        .chain(["/usr/sbin", "/usr/bin", "/sbin", "/bin"].map(PathBuf::from))
        .map(|dir| dir.join(name))
        .find(|p| p.is_file())
}

/// Standard output of a command, in the C locale so that what gets parsed
/// does not change with the user's language.
fn stdout_of(program: &str, args: &[&str]) -> String {
    Command::new(program)
        .args(args)
        .env("LC_ALL", "C")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default()
}

/// Package names, one per line — and nothing that is not one. A tool
/// asked for a list will sometimes answer with a question instead (pacman
/// prints its HoldPkg prompt to stdout even under `--print`), and that
/// text must not reach a list of things to remove.
fn package_names(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|l| {
            !l.is_empty()
                && !l.starts_with('-')
                && l.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '+' | '@'))
        })
        .map(String::from)
        .collect()
}

/// Which package manager family `os-release` declares, through `ID` or
/// through the `ID_LIKE` a derivative uses to name its parents.
fn family(os_release: &str) -> Option<Manager> {
    os_release
        .lines()
        .filter_map(|l| l.strip_prefix("ID=").or_else(|| l.strip_prefix("ID_LIKE=")))
        .flat_map(|v| v.trim().trim_matches(['"', '\'']).split_whitespace())
        .find_map(|id| match id.to_lowercase().as_str() {
            "arch" | "archlinux" => Some(Manager::Pacman),
            "debian" | "ubuntu" => Some(Manager::Apt),
            "fedora" | "rhel" | "centos" => Some(Manager::Dnf),
            s if s.contains("suse") || s == "sles" => Some(Manager::Zypper),
            _ => None,
        })
}

/// True when `/usr` cannot be written to even by root. Later lines shadow
/// earlier ones, and `/usr` decides over `/` when it is mounted separately.
fn usr_read_only(mounts: &str) -> bool {
    let (mut root, mut usr) = (None, None);
    for line in mounts.lines() {
        let mut fields = line.split_whitespace();
        let (Some(_), Some(point), Some(_), Some(opts)) = (fields.next(), fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        let read_only = opts.split(',').any(|o| o == "ro");
        match point {
            "/" => root = Some(read_only),
            "/usr" => usr = Some(read_only),
            _ => {}
        }
    }
    usr.or(root).unwrap_or(false)
}

/// An image-based system: Bazzite, Silverblue, SteamOS, MicroOS. Packages
/// there belong to the image, and removing one is not ours to attempt.
pub fn is_immutable() -> bool {
    Path::new("/run/ostree-booted").exists()
        || fs::read_to_string("/proc/self/mounts").map(|m| usr_read_only(&m)).unwrap_or(false)
}

pub fn os_release() -> String {
    fs::read_to_string("/etc/os-release").or_else(|_| fs::read_to_string("/usr/lib/os-release")).unwrap_or_default()
}

/// One value of an os-release text, without its quotes.
pub fn os_release_value(text: &str, key: &str) -> Option<String> {
    text.lines()
        .find_map(|l| l.strip_prefix(key)?.strip_prefix('='))
        .map(|v| v.trim().trim_matches(['"', '\'']).to_string())
        .filter(|v| !v.is_empty())
}

/// In the order a system that names no family is guessed at.
const MANAGERS: [Manager; 4] = [Manager::Pacman, Manager::Apt, Manager::Dnf, Manager::Zypper];

pub fn installed_managers() -> Vec<Manager> {
    MANAGERS.into_iter().filter(|m| find_program(m.program()).is_some()).collect()
}

/// The family os-release declares, provided its tool is actually here.
pub fn declared_family() -> Option<Manager> {
    family(&os_release()).filter(|m| find_program(m.program()).is_some())
}

/// The user's correction, as the core passes it to every module it starts.
/// Only a value from `allowed` counts; anything else is no answer.
fn preference(var: &str, allowed: &[&'static str]) -> Option<&'static str> {
    let value = std::env::var(var).ok()?;
    allowed.iter().copied().find(|a| *a == value)
}

/// The system's own package manager, or the reason there is none to use —
/// worded for the interface, which shows it as it comes.
pub fn manager() -> Result<Manager, String> {
    let ids = MANAGERS.map(Manager::id);
    manager_preferring(preference("POSMA_PKG_MANAGER", &ids).and_then(Manager::from_id))
}

/// `preferred` — what the user said this system is — decides only where the
/// system does not: a family os-release declares, with its tool installed,
/// always wins. The broker relies on that rule to keep which tool runs as
/// root a fact about the machine rather than about the request.
pub fn manager_preferring(preferred: Option<Manager>) -> Result<Manager, String> {
    if is_immutable() {
        return Err("Ten system jest niemutowalny (jak Bazzite, Silverblue czy SteamOS): pakietami zarządza obraz \
                    systemu i POSMA ich nie rusza. Aplikacje Flatpak działają normalnie."
            .into());
    }
    let installed = installed_managers();
    declared_family()
        .or(preferred.filter(|m| installed.contains(m)))
        // A derivative that names no parent: go by what is actually there.
        .or_else(|| installed.first().copied())
        .ok_or_else(|| "Nie rozpoznano menedżera pakietów tego systemu. Obsługiwane: apt, pacman, dnf i zypper.".into())
}

/// Size and file count of a directory. `only_ext` narrows it to one kind
/// of file; `recursive` descends.
/// pacman.conf may move the cache or add more than one, and `-Scc`
/// empties all of them.
fn pacman_cache_dirs() -> Vec<PathBuf> {
    let dirs: Vec<PathBuf> =
        stdout_of("pacman-conf", &["CacheDir"]).lines().map(str::trim).filter(|l| l.starts_with('/')).map(PathBuf::from).collect();
    if dirs.is_empty() { vec![PathBuf::from("/var/cache/pacman/pkg")] } else { dirs }
}

/// pacman downloads into a `download-XXXXXX` directory of its own inside
/// the cache and removes it when done. An interrupted download leaves it
/// behind, and `-Scc`, which unlinks entries one by one, then fails on
/// every such directory however empty the cache already is. None while a
/// pacman runs: the directory may be its download in progress.
pub fn pacman_leftover_downloads() -> Vec<PathBuf> {
    let db = stdout_of("pacman-conf", &["DBPath"]);
    let db = db.lines().map(str::trim).find(|l| l.starts_with('/')).unwrap_or("/var/lib/pacman/");
    if Path::new(db).join("db.lck").exists() {
        return Vec::new();
    }
    download_dirs_in(&pacman_cache_dirs())
}

/// Directories only, by their own type: a link named like one is not followed.
fn download_dirs_in(dirs: &[PathBuf]) -> Vec<PathBuf> {
    dirs.iter()
        .filter_map(|dir| fs::read_dir(dir).ok())
        .flatten()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("download-") && e.file_type().is_ok_and(|t| t.is_dir()))
        .map(|e| e.path())
        .collect()
}

fn measure(dir: &Path, recursive: bool, only_ext: Option<&str>) -> (u64, u64) {
    let Ok(read) = fs::read_dir(dir) else { return (0, 0) };
    let (mut bytes, mut files) = (0u64, 0u64);
    for entry in read.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            if recursive {
                let (b, f) = measure(&entry.path(), true, only_ext);
                bytes += b;
                files += f;
            }
        } else if meta.is_file() {
            let ext = entry.path().extension().and_then(|e| e.to_str()).map(String::from);
            if only_ext.is_none() || ext.as_deref() == only_ext {
                bytes += meta.len();
                files += 1;
            }
        }
    }
    (bytes, files)
}

/// `zypper packages` prints a table; the name is the third column of every
/// row whose status begins with `i`. Positional, so the translated header
/// does not matter.
fn zypper_names(table: &str) -> Vec<String> {
    table
        .lines()
        .filter_map(|l| {
            let cols: Vec<&str> = l.split('|').map(str::trim).collect();
            (cols.len() >= 5 && cols[0].starts_with('i')).then(|| cols[2].to_string())
        })
        .filter(|name| package_names(name).len() == 1)
        .collect()
}

/// `apt-get -s` marks each removal `Remv <name> [<version>]`, the same in
/// every language — unlike the heading above the list.
fn apt_simulated_removals(output: &str) -> Vec<String> {
    output
        .lines()
        .filter_map(|l| l.strip_prefix("Remv ")?.split_whitespace().next().map(String::from))
        .collect()
}

impl Manager {
    /// The name the broker protocol and the interface use for it.
    pub fn id(self) -> &'static str {
        match self {
            Manager::Apt => "apt",
            Manager::Pacman => "pacman",
            Manager::Dnf => "dnf",
            Manager::Zypper => "zypper",
        }
    }

    pub fn from_id(id: &str) -> Option<Manager> {
        MANAGERS.into_iter().find(|m| m.id() == id)
    }

    fn program(self) -> &'static str {
        match self {
            Manager::Apt => "apt-get",
            other => other.id(),
        }
    }

    /// Bytes and files in the download cache, readable without privilege.
    pub fn cache_usage(self) -> (u64, u64) {
        match self {
            // Flat and .deb only: partial/ beside them is root-only and
            // holds no finished package.
            Manager::Apt => measure(Path::new("/var/cache/apt/archives"), false, Some("deb")),
            // pacman.conf may move the cache or add more than one, and
            // `-Scc` empties all of them.
            Manager::Pacman => {
                pacman_cache_dirs().iter().map(|d| measure(d, false, None)).fold((0, 0), |(b, f), (db, df)| (b + db, f + df))
            }
            // dnf 5 and dnf 4 keep theirs in different places; a system
            // upgraded across the two can have both.
            Manager::Dnf => {
                let (b5, f5) = measure(Path::new("/var/cache/libdnf5"), true, None);
                let (b4, f4) = measure(Path::new("/var/cache/dnf"), true, None);
                (b5 + b4, f5 + f4)
            }
            Manager::Zypper => measure(Path::new("/var/cache/zypp"), true, None),
        }
    }

    /// Packages installed as dependencies that nothing needs any more.
    /// Always the manager's own answer: working out a dependency graph
    /// here could suggest removing something still in use.
    pub fn orphans(self) -> Vec<String> {
        match self {
            Manager::Apt => apt_simulated_removals(&stdout_of("apt-get", &["-s", "autoremove"])),
            Manager::Pacman => {
                let top = self.pacman_top_orphans();
                if top.is_empty() {
                    return top;
                }
                // Removing these takes their own now-unneeded dependencies
                // with them; ask pacman for the whole set so the preview
                // matches what will happen.
                let mut args = vec!["-Rs", "--print", "--print-format", "%n", "--"];
                args.extend(top.iter().map(String::as_str));
                let all = package_names(&stdout_of("pacman", &args));
                if all.is_empty() { top } else { all }
            }
            // No repositories: the question is only about what is
            // installed, and loading them as an ordinary user means a
            // download into /var/tmp.
            Manager::Dnf => package_names(&stdout_of("dnf", &["repoquery", "--unneeded", "--disablerepo=*", "--qf", "%{name}\n"])),
            Manager::Zypper => zypper_names(&stdout_of("zypper", &["--non-interactive", "--no-refresh", "packages", "--unneeded"])),
        }
    }

    /// Dependencies nothing requires, minus the packages pacman itself
    /// holds back (`HoldPkg`: pacman and glibc, plus whatever the
    /// distribution adds). Where a whole base system was installed as
    /// dependencies — container images are — those are "orphans" too, and
    /// naming one makes pacman refuse the entire removal.
    fn pacman_top_orphans(self) -> Vec<String> {
        let held = package_names(&stdout_of("pacman-conf", &["HoldPkg"]));
        package_names(&stdout_of("pacman", &["-Qdtq"])).into_iter().filter(|name| !held.contains(name)).collect()
    }

    pub fn clean_cache(self) -> Cmd {
        match self {
            Manager::Apt => cmd(&["apt-get", "clean"]),
            // `--noconfirm` takes each prompt's default, and the default
            // for "remove ALL files from cache?" is no — it exits 0 having
            // deleted nothing. The answers have to arrive on stdin.
            Manager::Pacman => Cmd { stdin: "y\ny\n", ..cmd(&["pacman", "-Scc"]) },
            Manager::Dnf => cmd(&["dnf", "clean", "all"]),
            Manager::Zypper => cmd(&["zypper", "--non-interactive", "clean", "--all"]),
        }
    }

    /// `None` when there is nothing to remove. pacman and zypper have no
    /// autoremove of their own, so the list is derived here — in the
    /// process that will act on it, not taken from the caller.
    pub fn autoremove(self) -> Option<Cmd> {
        let with_names = |head: &[&str], names: Vec<String>| {
            (!names.is_empty()).then(|| {
                let mut c = cmd(head);
                c.argv.extend(names);
                c
            })
        };
        match self {
            Manager::Apt => Some(cmd(&["apt-get", "autoremove", "-y"])),
            Manager::Dnf => Some(cmd(&["dnf", "autoremove", "-y"])),
            Manager::Pacman => with_names(&["pacman", "-Rns", "--noconfirm", "--"], self.pacman_top_orphans()),
            Manager::Zypper => with_names(&["zypper", "--non-interactive", "remove", "--clean-deps", "--"], self.orphans()),
        }
    }

    /// `id` must already have passed the broker's package-name check.
    pub fn remove(self, id: &str) -> Cmd {
        match self {
            Manager::Apt => cmd(&["apt-get", "remove", "-y", id]),
            Manager::Pacman => cmd(&["pacman", "-R", "--noconfirm", "--", id]),
            Manager::Dnf => cmd(&["dnf", "remove", "-y", id]),
            Manager::Zypper => cmd(&["zypper", "--non-interactive", "remove", "--", id]),
        }
    }

    /// Display only — what the user would type to install `package`.
    pub fn install_hint(self, package: &str) -> String {
        match self {
            Manager::Apt => format!("sudo apt install {package}"),
            Manager::Pacman => format!("sudo pacman -S {package}"),
            Manager::Dnf => format!("sudo dnf install {package}"),
            Manager::Zypper => format!("sudo zypper install {package}"),
        }
    }

    /// Whether old kernels pile up here and can be removed one by one.
    /// Where they cannot, the reason is the answer.
    pub fn kernel_removal(self) -> Result<(), &'static str> {
        match self {
            Manager::Apt | Manager::Dnf => Ok(()),
            Manager::Pacman => Err("Na tym systemie każdy pakiet jądra zawiera dokładnie jedną wersję, a aktualizacja ją \
                                    podmienia — stare jądra się nie odkładają, więc nie ma czego usuwać."),
            Manager::Zypper => Err("openSUSE samo usuwa stare jądra po restarcie (usługa purge-kernels), zostawiając \
                                    bieżące i poprzednie — POSMA się w to nie wtrąca."),
        }
    }
}

/// Packages the machine cannot do without, whatever the manager records
/// about who installed them. apt marks these itself (Essential, Priority)
/// and dnf refuses to remove its protected set; pacman and zypper leave it
/// to the user — zypper will remove zypper.
// ponytail: a list of names, not a reading of the dependency graph. It
// covers what breaks a system outright; move to each manager's own
// protected set (HoldPkg, protected.d) if it proves too short.
const CORE_PACKAGES: &[&str] = &[
    "base", "filesystem", "glibc", "systemd", "bash", "coreutils", "util-linux", "shadow", "shadow-utils", "sudo",
    "setup", "pacman", "rpm", "dnf", "dnf5", "yum", "zypper", "libzypp", "grub", "grub2", "grub2-common",
    "linux-firmware", "mkinitcpio", "dracut",
];

/// True for a package whose removal can leave the system unable to boot or
/// to manage its own packages. `kernels` is the package names `kernels()`
/// found — a kernel goes through the kernel manager's own checks, never a
/// plain removal. Shared by the uninstaller, which leaves these off its
/// list, and the broker, which refuses them whatever the list said.
pub fn is_core_package(name: &str, kernels: &HashSet<String>) -> bool {
    CORE_PACKAGES.contains(&name)
        || kernels.contains(name)
        || name.starts_with("kernel")
        || ["-keyring", "-mirrorlist", "-release"].iter().any(|suffix| name.ends_with(suffix))
}

// ------------------------------------------------------------- kernels

pub struct Kernel {
    /// What the package manager calls it, in the form its remove command
    /// accepts.
    pub package: String,
    /// What `uname -r` reports when it is the one running.
    pub version: String,
    pub size_bytes: u64,
    /// Never removable alongside the running one: the highest version,
    /// which is what the boot menu picks by default, and whatever the
    /// distribution's own `vmlinuz` symlink points at.
    pub is_latest: bool,
}

pub fn running_kernel() -> Option<String> {
    fs::read_to_string("/proc/sys/kernel/osrelease").ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Orders version strings the way a person reads them: digit runs compare
/// as numbers, so `6.8.0-100` is newer than `6.8.0-40`.
// ponytail: a pre-release suffix sorts above its release (6.12.0-rc1 >
// 6.12.0). It only widens what is locked; use a real version parser if
// that ever blocks someone.
pub fn version_cmp(a: &str, b: &str) -> Ordering {
    fn chunks(s: &str) -> Vec<&str> {
        let mut out = Vec::new();
        let mut start = 0;
        let bytes = s.as_bytes();
        for i in 1..=bytes.len() {
            if i == bytes.len() || bytes[i].is_ascii_digit() != bytes[start].is_ascii_digit() {
                out.push(&s[start..i]);
                start = i;
            }
        }
        out
    }
    let (ca, cb) = (chunks(a), chunks(b));
    for (x, y) in ca.iter().zip(&cb) {
        let ord = match (x.parse::<u64>(), y.parse::<u64>()) {
            (Ok(nx), Ok(ny)) => nx.cmp(&ny),
            _ => x.cmp(y),
        };
        if ord != Ordering::Equal {
            return ord;
        }
    }
    ca.len().cmp(&cb.len())
}

fn file_size(path: PathBuf) -> u64 {
    fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/// Debian and Ubuntu keep a symlink to the most recently installed kernel
/// — in /boot on Ubuntu, in / on Debian.
fn vmlinuz_symlink_version() -> Option<String> {
    ["/boot/vmlinuz", "/vmlinuz"].iter().find_map(|link| {
        let target = fs::read_link(link).ok()?;
        target.file_name()?.to_str()?.strip_prefix("vmlinuz-").map(String::from)
    })
}

fn modules_dirs() -> Vec<(String, PathBuf)> {
    let Ok(root) = fs::canonicalize("/lib/modules") else { return Vec::new() };
    let Ok(read) = fs::read_dir(root) else { return Vec::new() };
    read.flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| (e.file_name().to_string_lossy().into_owned(), e.path()))
        .collect()
}

/// Installed kernels, each with the package that owns it. Called by the
/// unprivileged module to show the list and again by the broker, as root,
/// before it removes anything — the broker never takes the list from the
/// request.
pub fn kernels(manager: Manager) -> Vec<Kernel> {
    let boot = Path::new("/boot");
    let mut found: Vec<Kernel> = match manager {
        // Only linux-image-<version> packages with a real image in /boot.
        // dpkg carries far more records than kernels: leftovers of past
        // updates and meta-packages that name no particular version.
        Manager::Apt => {
            let status = fs::read_to_string("/var/lib/dpkg/status").unwrap_or_default();
            status
                .split("\n\n")
                .filter(|stanza| stanza.lines().any(|l| l.starts_with("Status: ") && l.contains("install ok installed")))
                .filter_map(|stanza| stanza.lines().find_map(|l| l.strip_prefix("Package: ")).map(|p| p.trim().to_string()))
                .filter_map(|package| {
                    let version = package.strip_prefix("linux-image-")?.to_string();
                    let image = boot.join(format!("vmlinuz-{version}"));
                    image.is_file().then(|| Kernel {
                        size_bytes: file_size(image)
                            + file_size(boot.join(format!("initrd.img-{version}")))
                            + measure(&Path::new("/lib/modules").join(&version), true, None).0,
                        package,
                        version,
                        is_latest: false,
                    })
                })
                .collect()
        }
        // The kernel package leaves its own name beside the modules.
        Manager::Pacman => modules_dirs()
            .into_iter()
            .filter_map(|(version, dir)| {
                let package = fs::read_to_string(dir.join("pkgbase")).ok()?.trim().to_string();
                Some(Kernel {
                    size_bytes: measure(&dir, true, None).0
                        + file_size(boot.join(format!("vmlinuz-{package}")))
                        + file_size(boot.join(format!("initramfs-{package}.img"))),
                    package,
                    version,
                    is_latest: false,
                })
            })
            .collect(),
        Manager::Dnf | Manager::Zypper => modules_dirs()
            .into_iter()
            .filter_map(|(version, dir)| {
                let image = dir.join("vmlinuz");
                if !image.is_file() {
                    return None;
                }
                let owner = Command::new("rpm")
                    .args(["-qf", "--qf", "%{NAME}-%{VERSION}-%{RELEASE}.%{ARCH}\n"])
                    .arg(&image)
                    .output()
                    .ok()
                    .filter(|o| o.status.success())?;
                let package = String::from_utf8_lossy(&owner.stdout).lines().next()?.trim().to_string();
                Some(Kernel {
                    size_bytes: measure(&dir, true, None).0
                        + file_size(boot.join(format!("vmlinuz-{version}")))
                        + file_size(boot.join(format!("initramfs-{version}.img"))),
                    package,
                    version,
                    is_latest: false,
                })
            })
            .collect(),
    };

    let newest = found.iter().map(|k| k.version.clone()).max_by(|a, b| version_cmp(a, b));
    let linked = vmlinuz_symlink_version();
    for k in &mut found {
        k.is_latest = Some(&k.version) == newest.as_ref() || Some(&k.version) == linked.as_ref();
    }
    found.sort_by(|a, b| version_cmp(&b.version, &a.version));
    found
}

// ------------------------------------------------- desktop, boot loader
//
// The rest of what a module has to know: which desktop it themes and which
// loader boots the machine. The interface asks the user to confirm both at
// first start; a correction arrives as POSMA_DESKTOP / POSMA_BOOTLOADER in
// the environment of every module the core starts. The broker is not
// started that way and goes by detection alone.

pub const DESKTOPS: &[&str] = &["gnome", "plasma", "cinnamon", "mate", "xfce", "budgie", "pantheon", "lxqt", "cosmic", "other"];

/// XDG_CURRENT_DESKTOP is colon-separated and often prefixed ("ubuntu:GNOME",
/// "Budgie:GNOME"); DESKTOP_SESSION is sometimes a path to the session file.
/// Desktops that name GNOME after themselves are tried before it.
fn desktop_named(raw: &str) -> Option<&'static str> {
    const NEEDLES: [(&str, &str); 11] = [
        ("budgie", "budgie"),
        ("pantheon", "pantheon"),
        ("cinnamon", "cinnamon"),
        ("mate", "mate"),
        ("xfce", "xfce"),
        ("lxqt", "lxqt"),
        ("cosmic", "cosmic"),
        ("kde", "plasma"),
        ("plasma", "plasma"),
        ("gnome", "gnome"),
        // Ubuntu Unity keeps GNOME's settings schema.
        ("unity", "gnome"),
    ];
    let lower = raw.trim().to_lowercase();
    if lower.is_empty() {
        return None;
    }
    Some(NEEDLES.iter().find(|(needle, _)| lower.contains(needle)).map_or("other", |(_, id)| id))
}

pub fn desktop_detected() -> Option<&'static str> {
    let var = |name| std::env::var(name).ok().filter(|v: &String| !v.trim().is_empty());
    desktop_named(&var("XDG_CURRENT_DESKTOP").or_else(|| var("DESKTOP_SESSION"))?)
}

pub fn desktop() -> Option<&'static str> {
    preference("POSMA_DESKTOP", DESKTOPS).or_else(desktop_detected)
}

pub const BOOTLOADERS: &[&str] = &["grub", "systemd-boot", "limine", "refind", "other"];

pub fn bootloader_label(id: &str) -> &'static str {
    match id {
        "grub" => "GRUB",
        "systemd-boot" => "systemd-boot",
        "limine" => "Limine",
        "refind" => "rEFInd",
        _ => "inny program rozruchowy",
    }
}

/// What the loader that started this boot wrote into the Boot Loader
/// Interface variable. systemd-boot and Limine set it, and so does GRUB
/// where it is built with `bli` (Fedora). Readable without privilege and
/// gone after a reboot, so it is never stale. The first four bytes are the
/// variable's attributes, the rest UTF-16.
fn loader_info() -> Option<String> {
    let raw = fs::read("/sys/firmware/efi/efivars/LoaderInfo-4a67b082-0a4c-41cf-b6c7-440b29bb8c4f").ok()?;
    let units: Vec<u16> =
        raw.get(4..)?.as_chunks::<2>().0.iter().map(|&c| u16::from_le_bytes(c)).take_while(|&u| u != 0).collect();
    Some(String::from_utf16_lossy(&units))
}

/// "Limine 12.9.3", "systemd-boot 257.5", "GRUB 2.12".
fn bootloader_named(info: &str) -> &'static str {
    let lower = info.trim().to_lowercase();
    ["systemd-boot", "limine", "grub", "refind"].into_iter().find(|id| lower.starts_with(id)).unwrap_or("other")
}

/// The loader that booted, or failing that the one whose files are here.
/// Files are the weaker signal — a loader can be installed and unused, and
/// /boot is often root-only — so GRUB's own pair decides first, the same
/// pair `grub()` requires.
pub fn bootloader_detected() -> Option<&'static str> {
    if let Some(info) = loader_info() {
        return Some(bootloader_named(&info));
    }
    let any = |paths: &[&str]| paths.iter().any(|p| Path::new(p).exists());
    if any(&[GRUB_DEFAULTS]) && any(&["/boot/grub", "/boot/grub2"]) {
        return Some("grub");
    }
    // What a root-only ESP still leaves in sight: limine-entry-tool's
    // settings, rEFInd's kernel options.
    [("limine", &["/etc/default/limine"][..]), ("systemd-boot", &[]), ("refind", &["/boot/refind_linux.conf"])]
        .into_iter()
        .find(|(loader, hints)| loader_config(loader).is_some() || any(hints))
        .map(|(loader, _)| loader)
}

/// Where Limine, systemd-boot and rEFInd look for their config, in the
/// order each looks; the ESP may be mounted at /boot, /efi or /boot/efi.
fn loader_configs(loader: &str) -> &'static [&'static str] {
    match loader {
        "limine" => &[
            "/boot/EFI/limine/limine.conf",
            "/efi/EFI/limine/limine.conf",
            "/boot/efi/EFI/limine/limine.conf",
            "/boot/EFI/BOOT/limine.conf",
            "/efi/EFI/BOOT/limine.conf",
            "/boot/efi/EFI/BOOT/limine.conf",
            "/boot/limine/limine.conf",
            "/boot/limine.conf",
            "/efi/limine/limine.conf",
            "/efi/limine.conf",
        ],
        // The ESP before XBOOTLDR: loader.conf lives only on the ESP.
        "systemd-boot" => &["/efi/loader/loader.conf", "/boot/efi/loader/loader.conf", "/boot/loader/loader.conf"],
        "refind" => &[
            "/boot/EFI/refind/refind.conf",
            "/efi/EFI/refind/refind.conf",
            "/boot/efi/EFI/refind/refind.conf",
            "/boot/EFI/BOOT/refind.conf",
            "/efi/EFI/BOOT/refind.conf",
            "/boot/efi/EFI/BOOT/refind.conf",
        ],
        _ => &[],
    }
}

/// The file a loader that reads its own config at boot — Limine,
/// systemd-boot, rEFInd — is configured by, so editing it needs no rebuild
/// step. Usually on the ESP, which only root can read.
pub fn loader_config(loader: &str) -> Option<PathBuf> {
    loader_configs(loader).iter().map(Path::new).find(|p| p.is_file()).map(Path::to_path_buf)
}

/// That file's name, which is what the broker backs it up under wherever
/// it lies.
pub fn loader_config_name(loader: &str) -> Option<&'static str> {
    loader_configs(loader).first().and_then(|p| p.rsplit('/').next())
}

pub fn bootloader() -> Option<&'static str> {
    preference("POSMA_BOOTLOADER", BOOTLOADERS).or_else(bootloader_detected)
}

/// systemd's own test (`sd_booted`): it runs as init, not merely installed.
pub fn systemd_booted() -> bool {
    Path::new("/run/systemd/system").is_dir()
}

// ---------------------------------------------------------------- GRUB

pub const GRUB_DEFAULTS: &str = "/etc/default/grub";

pub struct Grub {
    /// The generated menu, root-only on most systems.
    pub cfg: PathBuf,
    pub themes_dir: PathBuf,
    /// Regenerates `cfg` from `/etc/default/grub`.
    pub regenerate: Vec<String>,
}

/// Where this system's GRUB lives and how its menu is rebuilt, or why the
/// editor has nothing to edit.
pub fn grub() -> Result<Grub, String> {
    if is_immutable() {
        return Err("Ten system jest niemutowalny — konfiguracją rozruchu zarządza obraz systemu, nie /etc/default/grub.".into());
    }
    // GRUB's files can outlive a switch to another loader; editing them
    // would change nothing at the next boot.
    if let Some(other) = bootloader().filter(|b| *b != "grub") {
        return Err(format!(
            "Ten system uruchamia się przez {}, nie przez GRUB — zmiany w plikach GRUB nie miałyby wpływu na rozruch.",
            bootloader_label(other)
        ));
    }
    if !Path::new(GRUB_DEFAULTS).is_file() {
        return Err("Nie znaleziono /etc/default/grub — ten system nie uruchamia się przez GRUB \
                    (używa np. systemd-boot, Limine albo rEFInd) lub konfiguruje go inaczej."
            .into());
    }
    // Debian's wrapper first: where it exists, it is what the distribution
    // expects to be run.
    let (dir, regenerate) = if let Some(tool) = find_program("update-grub") {
        ("/boot/grub", vec![tool.to_string_lossy().into_owned()])
    } else if let Some(tool) = find_program("grub-mkconfig") {
        ("/boot/grub", vec![tool.to_string_lossy().into_owned(), "-o".into(), "/boot/grub/grub.cfg".into()])
    } else if let Some(tool) = find_program("grub2-mkconfig") {
        ("/boot/grub2", vec![tool.to_string_lossy().into_owned(), "-o".into(), "/boot/grub2/grub.cfg".into()])
    } else {
        return Err("Jest /etc/default/grub, ale brakuje narzędzia do przebudowania menu (update-grub, grub-mkconfig, grub2-mkconfig).".into());
    };
    // The package can be installed without GRUB ever having been put on
    // the disk; regenerating a menu nothing reads would look like success.
    // A root-only /boot hides it from a module; "cannot tell" is left for
    // the broker, which looks again as root.
    let hidden = fs::metadata(dir).is_err_and(|e| e.kind() == std::io::ErrorKind::PermissionDenied);
    if !Path::new(dir).is_dir() && !hidden {
        return Err(format!(
            "Pakiet GRUB jest zainstalowany, ale nie ma katalogu {dir} — ten system uruchamia inny program rozruchowy."
        ));
    }
    Ok(Grub { cfg: Path::new(dir).join("grub.cfg"), themes_dir: Path::new(dir).join("themes"), regenerate })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Only pacman's own download directories: never a package, never a
    /// link that merely carries the name.
    #[cfg(unix)]
    #[test]
    fn only_leftover_download_directories_are_picked() {
        let cache = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/test-distro-pacman-cache");
        let _ = fs::remove_dir_all(&cache);
        fs::create_dir_all(cache.join("download-AbC123")).unwrap();
        fs::create_dir_all(cache.join("elsewhere")).unwrap();
        fs::write(cache.join("firefox-1.0-1-x86_64.pkg.tar.zst"), "").unwrap();
        fs::write(cache.join("download-file"), "").unwrap();
        std::os::unix::fs::symlink(cache.join("elsewhere"), cache.join("download-link")).unwrap();
        assert_eq!(download_dirs_in(std::slice::from_ref(&cache)), vec![cache.join("download-AbC123")]);
        fs::remove_dir_all(&cache).unwrap();
    }

    #[test]
    fn derivatives_resolve_through_id_like() {
        let cases = [
            ("ID=cachyos\nID_LIKE=arch\n", Manager::Pacman),
            ("ID=arch\n", Manager::Pacman),
            ("ID=linuxmint\nID_LIKE=\"ubuntu debian\"\n", Manager::Apt),
            ("ID=pop\nID_LIKE=\"ubuntu debian\"\n", Manager::Apt),
            ("ID=\"almalinux\"\nID_LIKE=\"rhel centos fedora\"\n", Manager::Dnf),
            ("ID=nobara\nID_LIKE=\"rhel centos fedora\"\n", Manager::Dnf),
            ("ID=\"opensuse-tumbleweed\"\nID_LIKE=\"opensuse suse\"\n", Manager::Zypper),
        ];
        for (text, expected) in cases {
            assert_eq!(family(text), Some(expected), "{text}");
        }
        assert_eq!(family("ID=void\n"), None);
        // VERSION_ID and friends must not be read as ID.
        assert_eq!(family("VERSION_ID=arch\nBUILD_ID=debian\n"), None);
    }

    #[test]
    fn read_only_usr_is_detected() {
        assert!(usr_read_only("overlay / overlay ro,relatime 0 0\n"));
        assert!(!usr_read_only("/dev/sda2 / ext4 rw,relatime 0 0\n"));
        // /usr mounted separately decides, in either direction.
        assert!(usr_read_only("/dev/sda2 / ext4 rw 0 0\n/dev/sda3 /usr ext4 ro 0 0\n"));
        assert!(!usr_read_only("/dev/sda2 / ext4 ro 0 0\n/dev/sda3 /usr ext4 rw 0 0\n"));
        // "ro" inside another option is not the flag.
        assert!(!usr_read_only("/dev/sda2 / ext4 rw,errors=remount-ro 0 0\n"));
        // NixOS: only the store is read-only.
        assert!(!usr_read_only("/dev/sda2 / ext4 rw 0 0\n/dev/sda2 /nix/store ext4 ro 0 0\n"));
    }

    #[test]
    fn zypper_table_yields_names_only() {
        let table = "Loading repository data...\nReading installed packages...\n\
                     S  | Repository              | Name | Version   | Arch\n\
                     ---+-------------------------+------+-----------+-------\n\
                     i  | openSUSE-Tumbleweed-Oss | jq   | 1.8.2-3.1 | x86_64\n\
                     i+ | openSUSE-Tumbleweed-Oss | nano | 8.6-1.1   | x86_64\n";
        assert_eq!(zypper_names(table), ["jq", "nano"]);
        assert!(zypper_names("Loading repository data...\nNo packages found.\n").is_empty());
    }

    #[test]
    fn a_prompt_is_not_a_package() {
        let out = "jq\noniguruma\n:: HoldPkg was found in target list. Do you want to continue? [y/N] \n--force\n\nlibstdc++\n";
        assert_eq!(package_names(out), ["jq", "oniguruma", "libstdc++"]);
    }

    #[test]
    fn apt_simulation_is_read_by_its_markers() {
        let out = "Reading package lists...\nThe following packages will be REMOVED:\n  libfoo1 libbar2\n\
                   Remv libfoo1 [1.2-3]\nRemv libbar2 [0.9]\n";
        assert_eq!(apt_simulated_removals(out), ["libfoo1", "libbar2"]);
    }

    #[test]
    fn versions_order_numerically() {
        let newer = |a, b| assert_eq!(version_cmp(a, b), Ordering::Greater, "{a} vs {b}");
        newer("6.8.0-100-generic", "6.8.0-40-generic");
        newer("7.0.0-38-generic", "7.0.0-34-generic");
        newer("6.12.5-200.fc41.x86_64", "6.11.4-301.fc41.x86_64");
        newer("6.10.2", "6.9.12");
        assert_eq!(version_cmp("6.8.0-40-generic", "6.8.0-40-generic"), Ordering::Equal);
    }

    #[test]
    fn core_packages_are_recognised() {
        let kernels: HashSet<String> = ["linux-cachyos".to_string(), "linux-image-6.8.0-40-generic".to_string()].into();
        for name in ["glibc", "pacman", "zypper", "linux-cachyos", "linux-image-6.8.0-40-generic", "kernel-core", "cachyos-keyring", "fedora-release"] {
            assert!(is_core_package(name, &kernels), "{name}");
        }
        for name in ["firefox", "nano", "discord", "linux-headers"] {
            assert!(!is_core_package(name, &kernels), "{name}");
        }
    }

    #[test]
    fn nothing_to_autoremove_is_no_command() {
        // The orphan-driven managers must not be handed a bare `remove`.
        // Neither tool exists on the machine running the test, or it has no
        // orphans; either way the answer has to be None or a full command.
        for m in [Manager::Pacman, Manager::Zypper] {
            if let Some(c) = m.autoremove() {
                assert!(c.argv.len() > c.argv.iter().position(|a| a == "--").unwrap() + 1);
            }
        }
    }

    #[test]
    fn os_release_values_are_read_by_exact_key() {
        let text = "NAME=\"CachyOS Linux\"\nPRETTY_NAME=\"CachyOS\"\nID=cachyos\nID_LIKE=arch\nVERSION_ID=1\n";
        assert_eq!(os_release_value(text, "PRETTY_NAME").as_deref(), Some("CachyOS"));
        assert_eq!(os_release_value(text, "ID").as_deref(), Some("cachyos"));
        assert_eq!(os_release_value(text, "ID_LIKE").as_deref(), Some("arch"));
        assert_eq!(os_release_value("ID=\n", "ID"), None);
    }

    #[test]
    fn sessions_name_their_desktop() {
        let cases = [
            ("ubuntu:GNOME", "gnome"),
            ("GNOME-Classic:GNOME", "gnome"),
            ("KDE", "plasma"),
            ("/usr/share/wayland-sessions/plasma.desktop", "plasma"),
            ("X-Cinnamon", "cinnamon"),
            ("MATE", "mate"),
            ("XFCE", "xfce"),
            ("Budgie:GNOME", "budgie"),
            ("Pantheon", "pantheon"),
            ("Unity", "gnome"),
            ("COSMIC", "cosmic"),
            ("Hyprland", "other"),
        ];
        for (raw, id) in cases {
            assert_eq!(desktop_named(raw), Some(id), "{raw}");
            assert!(DESKTOPS.contains(&id));
        }
        assert_eq!(desktop_named("  "), None);
    }

    #[test]
    fn the_loader_names_itself() {
        assert_eq!(bootloader_named("Limine 12.9.3"), "limine");
        assert_eq!(bootloader_named("systemd-boot 257.5-1-arch"), "systemd-boot");
        assert_eq!(bootloader_named("GRUB 2.12"), "grub");
        assert_eq!(bootloader_named("rEFInd 0.14"), "refind");
        assert_eq!(bootloader_named("Clover"), "other");
    }

    #[test]
    fn a_preference_outside_the_list_is_no_answer() {
        assert_eq!(Manager::from_id("pacman"), Some(Manager::Pacman));
        assert_eq!(Manager::from_id("apt-get"), None);
        // A variable of this test's own, so no other test sees it.
        std::env::set_var("POSMA_TEST_PREFERENCE", "kde");
        assert_eq!(preference("POSMA_TEST_PREFERENCE", DESKTOPS), None);
        std::env::set_var("POSMA_TEST_PREFERENCE", "plasma");
        assert_eq!(preference("POSMA_TEST_PREFERENCE", DESKTOPS), Some("plasma"));
    }
}
