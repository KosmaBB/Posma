//! Validation and safe-filesystem helpers shared by every OS broker.
//!
//! These live here rather than in an individual broker so the rule has one
//! definition instead of a copy per module that can drift:
//!
//!  - `is_safe_package_id` — a name starting with `-` is read as a FLAG by
//!    apt/snap/winget/brew, so it must be rejected even though
//!    `Command::args` is not shell-interpreted.
//!  - `is_same_file` — `fs::copy` opens the destination for writing (which
//!    truncates it) BEFORE reading the source, so copying a file onto
//!    itself destroys its contents with nothing left to copy back. Any
//!    copy/move helper here checks this per file pair.
//!  - `backup_and_rotate` + `write_with_backup` — Access_plan.md's "backup
//!    przed boot" invariant, generalized: no broker anywhere writes a
//!    system config without a rotated backup and an automatic rollback if
//!    post-write verification fails.
//!  - `contained_in` — `Path::starts_with` is ALSO true for the root
//!    itself, so a check written without an inequality lets a request
//!    naming a whitelist root take the entire tree instead of one entry
//!    inside it.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Package/app identifier charset accepted by every backend's own naming
/// rules. Crucially rejects a leading `-` (flag smuggling) and anything
/// with path separators.
pub fn is_safe_package_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && !id.starts_with('-')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '+' | '@'))
}

/// A plain display/directory name: no separators, no traversal, no leading
/// dash. Used for theme names, service names, backup filenames.
pub fn is_safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 120
        && !name.starts_with('-')
        && !name.contains("..")
        && !name.contains('/')
        && !name.contains('\\')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' '))
}

/// True when `candidate` sits strictly INSIDE `root` — never equal to it.
/// The inequality is load-bearing: `Path::starts_with` returns true for an
/// equal path, so without it a request naming the root itself passes a
/// "must be inside the whitelist" check and takes the entire tree.
pub fn contained_in(candidate: &Path, root: &Path) -> bool {
    let Ok(root_canon) = root.canonicalize() else { return false };
    // Resolve the PARENT, not the path itself: the target may be a symlink
    // to be unlinked (resolving it would escape to its destination) or may
    // not exist yet.
    let Some(parent) = candidate.parent() else { return false };
    let Ok(parent_canon) = parent.canonicalize() else { return false };
    let full = parent_canon.join(candidate.file_name().unwrap_or_default());
    full.starts_with(&root_canon) && full != root_canon
}

/// True when both paths resolve to the same file on disk. See the module
/// docs — this is what stops a self-copy from truncating real data.
pub fn is_same_file(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

/// Recursive copy that never follows symlinks and never self-copies.
pub fn copy_dir_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    if is_same_file(src, dst) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "źródło i cel to ten sam folder",
        ));
    }
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)?.flatten() {
        let file_type = entry.file_type()?;
        let dest_path = dst.join(entry.file_name());
        if file_type.is_symlink() {
            continue;
        } else if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else if file_type.is_file() && !is_same_file(&entry.path(), &dest_path) {
            fs::copy(entry.path(), &dest_path)?;
        }
    }
    Ok(())
}

/// Where backups of a given system file live. Keyed by the file's name so
/// several different configs can be managed without colliding.
pub fn backup_dir_for(path: &Path) -> PathBuf {
    let stem = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "system".into());
    PathBuf::from("/var/backups/posma").join(stem)
}

/// Snapshots `content` into `dir`, then trims to the `keep_backups` most
/// recent. Backups are world-readable so unprivileged sidecars can list
/// them without a privileged round-trip.
///
/// The directory is a parameter rather than derived here so callers stay
/// explicit about where privileged state lands, and so the rotation and
/// rollback behaviour can be exercised without writing to /var/backups.
pub fn backup_and_rotate(dir: &Path, content: &str, keep_backups: u64) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o755));
    }

    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let backup_path = dir.join(format!("backup.{timestamp}"));
    fs::write(&backup_path, content)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&backup_path, fs::Permissions::from_mode(0o644));
    }

    let mut backups: Vec<_> = fs::read_dir(dir)?
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("backup."))
        .collect();
    backups.sort_by_key(|e| e.file_name());
    let keep = keep_backups.clamp(1, 50) as usize;
    while backups.len() > keep {
        let oldest = backups.remove(0);
        let _ = fs::remove_file(oldest.path());
    }
    Ok(())
}

/// Writes a file via a sibling temp file + rename so an interrupted write
/// can never leave a truncated original behind.
pub fn write_atomic(target: &Path, data: &[u8]) -> io::Result<()> {
    use std::io::Write;
    let dir = target.parent().unwrap_or_else(|| Path::new("."));
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "plik".into());
    let tmp = dir.join(format!(".{name}.posma-tmp"));

    let original_perms = fs::metadata(target).map(|m| m.permissions()).ok();
    let write_result = (|| -> io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()
    })();
    if let Err(e) = write_result {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    if let Some(perms) = original_perms {
        let _ = fs::set_permissions(&tmp, perms);
    }
    if let Err(e) = fs::rename(&tmp, target) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

/// The full "safely replace a system config" pipeline every OS reuses:
/// backup + rotate, atomic write, run `verify`, and if verification fails
/// restore the previous content and re-run verification from that
/// known-good state before reporting the original failure.
///
/// `verify` is whatever proves the new config is usable on this OS
/// (`update-grub` on Linux, a plist lint on macOS, ...). A broker with no
/// meaningful check passes `|| Ok(())`.
pub fn write_with_backup<F>(
    target: &Path,
    backup_dir: &Path,
    content: &str,
    keep_backups: u64,
    verify: F,
) -> Result<String, String>
where
    F: Fn() -> Result<String, String>,
{
    if content.trim().is_empty() || content.len() > 4_000_000 {
        return Err("nieprawidłowa zawartość konfiguracji".into());
    }
    let previous = fs::read_to_string(target).unwrap_or_default();

    backup_and_rotate(backup_dir, &previous, keep_backups)
        .map_err(|e| format!("nie udało się utworzyć kopii zapasowej: {e}"))?;
    write_atomic(target, content.as_bytes()).map_err(|e| format!("nie udało się zapisać: {e}"))?;

    match verify() {
        Ok(output) => Ok(output),
        Err(verify_error) => {
            let _ = write_atomic(target, previous.as_bytes());
            let _ = verify();
            Err(format!(
                "weryfikacja nie powiodła się — przywrócono poprzednią konfigurację. {verify_error}"
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// Unique scratch directory per test, removed on drop.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(label: &str) -> Self {
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let dir = std::env::temp_dir().join(format!("posma-guards-{label}-{}-{n}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).expect("scratch dir");
            Self(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
        fn file(&self, name: &str, contents: &str) -> PathBuf {
            let p = self.0.join(name);
            if let Some(parent) = p.parent() {
                fs::create_dir_all(parent).expect("parent");
            }
            fs::write(&p, contents).expect("write");
            p
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    // ------------------------------------------------------- package ids

    #[test]
    fn package_id_rejects_leading_dash() {
        // A leading dash is read as a FLAG by apt/snap/winget/brew even
        // though arguments are never shell-interpreted.
        assert!(!is_safe_package_id("--reinstall"));
        assert!(!is_safe_package_id("-y"));
    }

    #[test]
    fn package_id_rejects_separators_and_empty() {
        assert!(!is_safe_package_id(""));
        assert!(!is_safe_package_id("../etc/passwd"));
        assert!(!is_safe_package_id("foo/bar"));
        assert!(!is_safe_package_id("foo bar"));
        assert!(!is_safe_package_id(&"a".repeat(201)));
    }

    #[test]
    fn package_id_accepts_real_names() {
        for id in [
            "firefox",
            "linux-image-6.8.0-40-generic",
            "com.discordapp.Discord",
            "docker-ce-cli",
            "python3.12",
            "g++",
            "Microsoft.VisualStudioCode",
        ] {
            assert!(is_safe_package_id(id), "should accept {id}");
        }
    }

    // ------------------------------------------------------------- names

    #[test]
    fn name_rejects_traversal_and_separators() {
        assert!(!is_safe_name(""));
        assert!(!is_safe_name(".."));
        assert!(!is_safe_name("../evil"));
        assert!(!is_safe_name("a/b"));
        assert!(!is_safe_name("a\\b"));
        assert!(!is_safe_name("-flag"));
    }

    #[test]
    fn name_accepts_plain_names() {
        assert!(is_safe_name("Elegant"));
        assert!(is_safe_name("backup.1785463414"));
        assert!(is_safe_name("My Theme 2"));
    }

    // -------------------------------------------------------- containment

    #[test]
    fn contained_in_accepts_entry_inside_root() {
        let s = Scratch::new("contained-inside");
        let f = s.file("child.txt", "x");
        assert!(contained_in(&f, s.path()));
    }

    #[test]
    fn contained_in_accepts_nested_entry() {
        let s = Scratch::new("contained-nested");
        let f = s.file("deep/nested/child.txt", "x");
        assert!(contained_in(&f, s.path()));
    }

    /// Regression guard: `Path::starts_with` is true for an equal path, so a
    /// containment check written without the inequality would accept the
    /// whitelist root itself and allow deleting the entire tree.
    #[test]
    fn contained_in_rejects_the_root_itself() {
        let s = Scratch::new("contained-root");
        assert!(!contained_in(s.path(), s.path()));
    }

    #[test]
    fn contained_in_rejects_outside_paths() {
        let root = Scratch::new("contained-root-a");
        let other = Scratch::new("contained-root-b");
        let f = other.file("child.txt", "x");
        assert!(!contained_in(&f, root.path()));
    }

    #[test]
    fn contained_in_rejects_when_parent_is_missing() {
        let s = Scratch::new("contained-missing");
        let f = s.path().join("no-such-dir").join("child.txt");
        assert!(!contained_in(&f, s.path()));
    }

    // --------------------------------------------------------- same file

    #[test]
    fn same_file_detects_identical_path() {
        let s = Scratch::new("same-identical");
        let f = s.file("a.txt", "content");
        assert!(is_same_file(&f, &f));
    }

    #[test]
    fn same_file_detects_path_reached_differently() {
        let s = Scratch::new("same-indirect");
        let f = s.file("a.txt", "content");
        let indirect = s.path().join(".").join("a.txt");
        assert!(is_same_file(&f, &indirect));
    }

    #[test]
    fn same_file_separates_distinct_files() {
        let s = Scratch::new("same-distinct");
        let a = s.file("a.txt", "content");
        let b = s.file("b.txt", "content");
        assert!(!is_same_file(&a, &b));
    }

    // ------------------------------------------------------------- copy

    /// Regression guard: `fs::copy` truncates the destination before reading
    /// the source, so a directory copied onto itself would zero every file.
    #[test]
    fn copy_refuses_to_copy_a_directory_onto_itself() {
        let s = Scratch::new("copy-self");
        s.file("theme.txt", "real content");
        s.file("background.jpg", "image bytes");

        assert!(copy_dir_recursive(s.path(), s.path()).is_err());

        assert_eq!(fs::read_to_string(s.path().join("theme.txt")).unwrap(), "real content");
        assert_eq!(fs::read_to_string(s.path().join("background.jpg")).unwrap(), "image bytes");
    }

    #[test]
    fn copy_copies_nested_content() {
        let src = Scratch::new("copy-src");
        src.file("theme.txt", "top");
        src.file("icons/linux.png", "icon");
        let dst = Scratch::new("copy-dst");
        let target = dst.path().join("installed");

        copy_dir_recursive(src.path(), &target).expect("copy");

        assert_eq!(fs::read_to_string(target.join("theme.txt")).unwrap(), "top");
        assert_eq!(fs::read_to_string(target.join("icons/linux.png")).unwrap(), "icon");
    }

    #[cfg(unix)]
    #[test]
    fn copy_never_follows_symlinks() {
        let outside = Scratch::new("copy-outside");
        let secret = outside.file("secret.txt", "should not be copied");

        let src = Scratch::new("copy-symlink-src");
        src.file("theme.txt", "top");
        std::os::unix::fs::symlink(&secret, src.path().join("link.txt")).expect("symlink");

        let dst = Scratch::new("copy-symlink-dst");
        let target = dst.path().join("installed");
        copy_dir_recursive(src.path(), &target).expect("copy");

        assert!(target.join("theme.txt").exists());
        assert!(!target.join("link.txt").exists(), "symlink must not be followed or recreated");
    }

    // ---------------------------------------------------------- atomic write

    #[test]
    fn atomic_write_replaces_content_and_leaves_no_temp_file() {
        let s = Scratch::new("atomic");
        let f = s.file("config", "old");

        write_atomic(&f, b"new").expect("write");

        assert_eq!(fs::read_to_string(&f).unwrap(), "new");
        let leftovers: Vec<_> = fs::read_dir(s.path())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains("posma-tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp file must not survive");
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_preserves_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let s = Scratch::new("atomic-perms");
        let f = s.file("config", "old");
        fs::set_permissions(&f, fs::Permissions::from_mode(0o600)).unwrap();

        write_atomic(&f, b"new").expect("write");

        let mode = fs::metadata(&f).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    // ------------------------------------------------------ backup rotation

    #[test]
    fn backup_rotation_keeps_only_the_requested_number() {
        let s = Scratch::new("rotate");
        let dir = s.path().join("backups");

        for i in 0..5 {
            backup_and_rotate(&dir, &format!("generation {i}"), 2).expect("backup");
            // Backup filenames carry a whole-second timestamp; step past it
            // so each generation gets a distinct name.
            std::thread::sleep(std::time::Duration::from_millis(1100));
        }

        let count = fs::read_dir(&dir).unwrap().flatten().count();
        assert_eq!(count, 2, "should retain exactly the two most recent");
    }

    #[test]
    fn backup_rotation_never_drops_below_one() {
        let s = Scratch::new("rotate-zero");
        let dir = s.path().join("backups");
        backup_and_rotate(&dir, "only", 0).expect("backup");
        assert_eq!(fs::read_dir(&dir).unwrap().flatten().count(), 1);
    }

    // -------------------------------------------------- write_with_backup

    #[test]
    fn write_with_backup_rejects_empty_content() {
        let s = Scratch::new("wwb-empty");
        let f = s.file("config", "original");
        let dir = s.path().join("backups");

        assert!(write_with_backup(&f, &dir, "   ", 2, || Ok(String::new())).is_err());
        assert_eq!(fs::read_to_string(&f).unwrap(), "original");
    }

    #[test]
    fn write_with_backup_writes_and_snapshots_the_previous_content() {
        let s = Scratch::new("wwb-ok");
        let f = s.file("config", "original");
        let dir = s.path().join("backups");

        write_with_backup(&f, &dir, "updated", 2, || Ok("verified".into())).expect("write");

        assert_eq!(fs::read_to_string(&f).unwrap(), "updated");
        let backups: Vec<_> = fs::read_dir(&dir).unwrap().flatten().collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(fs::read_to_string(backups[0].path()).unwrap(), "original");
    }

    /// The core safety property: a configuration that fails verification is
    /// rolled back, and verification is re-run from the restored state.
    #[test]
    fn write_with_backup_rolls_back_when_verification_fails() {
        let s = Scratch::new("wwb-rollback");
        let f = s.file("config", "original");
        let dir = s.path().join("backups");

        let calls = std::cell::RefCell::new(Vec::<String>::new());
        let result = write_with_backup(&f, &dir, "broken", 2, || {
            let seen = fs::read_to_string(&f).unwrap();
            calls.borrow_mut().push(seen.clone());
            if seen == "broken" {
                Err("regeneration failed".into())
            } else {
                Ok("recovered".into())
            }
        });

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(&f).unwrap(),
            "original",
            "failed verification must restore the previous configuration"
        );
        assert_eq!(
            calls.borrow().as_slice(),
            &["broken".to_string(), "original".to_string()],
            "verification must run again from the restored state"
        );
    }
}
