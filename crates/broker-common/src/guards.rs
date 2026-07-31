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

/// Snapshots `content` into the backup directory, then trims to the
/// `keep_backups` most recent. Backups are world-readable so unprivileged
/// sidecars can list them without a privileged round-trip.
pub fn backup_and_rotate(target: &Path, content: &str, keep_backups: u64) -> io::Result<()> {
    let dir = backup_dir_for(target);
    fs::create_dir_all(&dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o755));
    }

    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let backup_path = dir.join(format!("backup.{timestamp}"));
    fs::write(&backup_path, content)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&backup_path, fs::Permissions::from_mode(0o644));
    }

    let mut backups: Vec<_> = fs::read_dir(&dir)?
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

    backup_and_rotate(target, &previous, keep_backups)
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
