//! What a scanner is allowed to show, in one place.
//!
//! Three modules walk the filesystem looking for things to clean up, and
//! each was deciding for itself what to ignore — one had a list, two had
//! nothing. A file the user must never be offered has to be invisible to
//! all of them or the rule means nothing.
//!
//! Two categories, because they are not the same question:
//!
//! * **Blocked** — never shown by anything. Another operating system's
//!   volume, the running system's own files, and whatever the user has
//!   added by hand. Offering these is at best noise and at worst an
//!   invitation to break the machine.
//! * **Noise** — real files the user did not author: dependency trees,
//!   build output, game installs. Worth hiding from "what can I delete"
//!   because deleting them by hand is the wrong tool, but worth *counting*
//!   in a disk map, where the question is where the space went.

use std::path::{Component, Path};

use serde::Deserialize;

/// Why a path was rejected, or that it was not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Allowed,
    /// Never show this, in any module.
    Blocked,
    /// Not the user's own content. Hide it from cleanup, count it in a map.
    Noise,
}

/// Directory names belonging to the running system or to another one
/// sharing the disk. Matched by name at any depth, because a mounted
/// Windows volume puts them under an arbitrary mount point.
const BLOCKED_NAMES: &[&str] = &[
    // Windows, as seen from a mounted NTFS volume
    "Windows", "Program Files", "Program Files (x86)", "ProgramData",
    "$Recycle.Bin", "System Volume Information", "Recovery", "$WinREAgent",
    // macOS
    "System", "Library", "private", ".Spotlight-V100", ".fseventsd",
    ".DocumentRevisions-V100", ".TemporaryItems",
    // Linux
    "proc", "sys", "dev", "run", "boot",
];

/// Absolute prefixes that are the running system, not the user's files.
const BLOCKED_PREFIXES: &[&str] = &[
    "/proc", "/sys", "/dev", "/run", "/boot", "/etc", "/usr", "/bin", "/sbin",
    "/lib", "/lib64", "/var/lib", "/snap",
    "/System", "/Library", "/private", "/Applications",
];

/// Generated or installed content. Real files, but not authored by anyone,
/// and hand-deleting them is the wrong way to reclaim the space.
const NOISE_NAMES: &[&str] = &[
    // toolchains and dependency trees
    ".git", ".hg", ".svn",
    "node_modules", "target", ".cache", "__pycache__", ".venv", "venv",
    "build", "dist", "out", ".gradle", ".idea", ".next", ".nuxt", ".cxx",
    "Pods", "DerivedData", "vendor", ".dart_tool",
    // games — large, replaceable, and never what someone means by "my files"
    "steamapps", "SteamLibrary", "Steam", "compatdata", "shadercache",
    "Epic Games", "GOG Galaxy", "Battle.net", "Riot Games", "Origin Games",
    "EA Games", "Ubisoft", "Lutris", "Heroic", "Bottles",
    ".minecraft", "Unity", "Unreal Projects",
];

/// The rules in force for one scan.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Filter {
    /// Absolute paths the user marked. Anything at or below one is blocked.
    #[serde(default)]
    pub blacklist: Vec<String>,
    /// Set by a disk map, where generated content still occupies space and
    /// hiding it would misreport where the space went.
    #[serde(default)]
    pub include_noise: bool,
}

impl Filter {
    pub fn new(blacklist: Vec<String>) -> Self {
        Self { blacklist, include_noise: false }
    }

    /// Counts everything that is not outright blocked. For a disk map.
    pub fn including_noise(blacklist: Vec<String>) -> Self {
        Self { blacklist, include_noise: true }
    }

    pub fn verdict(&self, path: &Path) -> Verdict {
        if self.is_blacklisted(path) || is_system(path) {
            return Verdict::Blocked;
        }
        if is_noise(path) {
            return Verdict::Noise;
        }
        Verdict::Allowed
    }

    /// Whether a scan should descend into, or report, this path.
    pub fn allows(&self, path: &Path) -> bool {
        match self.verdict(path) {
            Verdict::Allowed => true,
            Verdict::Noise => self.include_noise,
            Verdict::Blocked => false,
        }
    }

    /// True when the path is at or below something the user listed.
    ///
    /// Compared component by component rather than as a string prefix, so
    /// "/home/k/Photos2" is not treated as living inside "/home/k/Photos".
    fn is_blacklisted(&self, path: &Path) -> bool {
        self.blacklist.iter().any(|entry| {
            let root = Path::new(entry);
            path == root || path.starts_with(root)
        })
    }
}

fn name_of(path: &Path) -> Option<&str> {
    path.file_name().and_then(|n| n.to_str())
}

/// Any component of the path naming a system directory, or an absolute
/// prefix that is one.
fn is_system(path: &Path) -> bool {
    if BLOCKED_PREFIXES.iter().any(|p| path.starts_with(p)) {
        return true;
    }
    path.components().any(|c| match c {
        Component::Normal(part) => part
            .to_str()
            .is_some_and(|s| BLOCKED_NAMES.iter().any(|b| b.eq_ignore_ascii_case(s))),
        _ => false,
    })
}

fn is_noise(path: &Path) -> bool {
    name_of(path).is_some_and(|n| NOISE_NAMES.iter().any(|b| b.eq_ignore_ascii_case(n)))
        || path.components().any(|c| match c {
            Component::Normal(part) => part
                .to_str()
                .is_some_and(|s| NOISE_NAMES.iter().any(|b| b.eq_ignore_ascii_case(s))),
            _ => false,
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f() -> Filter {
        Filter::new(vec!["/home/k/Zdjęcia firmowe".into()])
    }

    #[test]
    fn ordinary_files_are_allowed() {
        assert_eq!(f().verdict(Path::new("/home/k/Dokumenty/list.odt")), Verdict::Allowed);
    }

    #[test]
    fn the_user_list_wins_everywhere_below_it() {
        let f = f();
        assert_eq!(f.verdict(Path::new("/home/k/Zdjęcia firmowe")), Verdict::Blocked);
        assert_eq!(
            f.verdict(Path::new("/home/k/Zdjęcia firmowe/2024/DSC_0001.raw")),
            Verdict::Blocked
        );
    }

    /// A string prefix test would swallow this one.
    #[test]
    fn a_sibling_with_a_longer_name_is_not_inside() {
        assert_eq!(
            f().verdict(Path::new("/home/k/Zdjęcia firmowe 2/x.jpg")),
            Verdict::Allowed
        );
    }

    /// The case that motivated this: a dual-boot machine mounts the other
    /// system's disk, and its files must never be offered for deletion.
    #[test]
    fn another_systems_volume_is_blocked() {
        let f = f();
        for p in [
            "/media/k/Dysk/Windows/System32/kernel32.dll",
            "/media/k/Dysk/Program Files/App/data.bin",
            "/media/k/Dysk/$Recycle.Bin/x",
            "/Volumes/Macintosh HD/System/Library/x",
        ] {
            assert_eq!(f.verdict(Path::new(p)), Verdict::Blocked, "{p}");
        }
    }

    #[test]
    fn the_running_system_is_blocked() {
        let f = f();
        for p in ["/usr/bin/ls", "/proc/1/status", "/etc/passwd", "/Library/Caches/x"] {
            assert_eq!(f.verdict(Path::new(p)), Verdict::Blocked, "{p}");
        }
    }

    #[test]
    fn games_and_build_output_are_noise_not_blocked() {
        let f = f();
        for p in [
            "/home/k/.steam/steamapps/common/Game/game.pak",
            "/home/k/projekt/node_modules/left-pad/index.js",
            "/home/k/.minecraft/saves/world/level.dat",
        ] {
            assert_eq!(f.verdict(Path::new(p)), Verdict::Noise, "{p}");
        }
    }

    /// A cleanup scanner hides noise; a disk map has to count it, or it
    /// reports the wrong answer to "where did my space go".
    #[test]
    fn noise_is_hidden_from_cleanup_and_counted_in_a_map() {
        let game = Path::new("/home/k/.steam/steamapps/common/Game/game.pak");
        assert!(!Filter::new(vec![]).allows(game));
        assert!(Filter::including_noise(vec![]).allows(game));
    }

    /// Blocked stays blocked even for a disk map — it is not ours to show.
    #[test]
    fn a_map_still_refuses_blocked_paths() {
        let win = Path::new("/media/k/Dysk/Windows/System32");
        assert!(!Filter::including_noise(vec![]).allows(win));
    }

    #[test]
    fn matching_ignores_case() {
        assert_eq!(
            Filter::new(vec![]).verdict(Path::new("/media/k/D/WINDOWS/x")),
            Verdict::Blocked
        );
    }
}
