//! kernel-mgr sidecar: lists installed Linux kernel images, distinguishing
//! the currently-running one and the "latest installed" one (both always
//! protected from removal) from genuinely old, safe-to-remove ones.
//! Read-only — actual removal always needs root and goes through the
//! privileged broker's `remove_kernel` op, which independently re-derives
//! the running/latest kernel itself rather than trusting this sidecar or
//! the frontend (modules/linux-broker/src/main.rs) — the highest-stakes
//! operation in this project so far (Access_plan.md marks this module
//! "critical" risk), so it gets the most defense-in-depth, not less.
//!
//! Only `linux-image-*` packages with a REAL corresponding
//! /boot/vmlinuz-<version> file are considered at all. This matters in
//! practice: a system typically carries far more `linux-image-*` dpkg
//! records than actual kernels, the surplus being stale bookkeeping from
//! past updates (no files, no disk space) plus meta-packages such as
//! linux-image-generic-hwe-24.04 that don't correspond to one specific
//! version. Both are silently excluded rather than shown as confusing,
//! unactionable entries.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"scan"}

use std::fs;
use std::io::{self, BufRead, Write};
use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Scan,
}

#[derive(Serialize)]
struct KernelEntry {
    package: String,
    version: String,
    size_bytes: u64,
    is_running: bool,
    is_latest: bool,
}

#[derive(Serialize)]
struct ScanResult {
    running: String,
    latest: String,
    kernels: Vec<KernelEntry>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Response<T: Serialize> {
    Ok { ok: bool, data: T },
    Err { ok: bool, error: String },
}

fn ok<T: Serialize>(data: T) -> Response<T> {
    Response::Ok { ok: true, data }
}

fn running_version() -> String {
    Command::new("uname")
        .arg("-r")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// The `/boot/vmlinuz` symlink always points at the most recently
/// installed kernel (Debian/Ubuntu convention; `vmlinuz.old` points at the
/// previous one) — this is authoritative regardless of what GRUB's actual
/// default boot entry is set to.
fn latest_version() -> String {
    fs::read_link("/boot/vmlinuz")
        .ok()
        .and_then(|p| p.file_name().map(|f| f.to_string_lossy().into_owned()))
        .and_then(|name| name.strip_prefix("vmlinuz-").map(|s| s.to_string()))
        .unwrap_or_default()
}

fn dir_size(path: &Path) -> u64 {
    let mut size = 0u64;
    let Ok(read) = fs::read_dir(path) else { return 0 };
    for entry in read.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            size += dir_size(&entry.path());
        } else if meta.is_file() {
            size += meta.len();
        }
    }
    size
}

/// Same dpkg-status parsing style as modules/uninstaller's `dpkg_installed`,
/// scoped down to just package name + install status since that's all
/// this needs.
fn installed_kernel_packages() -> Vec<String> {
    let mut out = Vec::new();
    let Ok(content) = fs::read_to_string("/var/lib/dpkg/status") else { return out };
    for stanza in content.split("\n\n") {
        let mut name = None;
        let mut status = None;
        for line in stanza.lines() {
            if let Some(v) = line.strip_prefix("Package: ") {
                name = Some(v.trim().to_string());
            } else if let Some(v) = line.strip_prefix("Status: ") {
                status = Some(v.trim().to_string());
            }
        }
        let (Some(name), Some(status)) = (name, status) else { continue };
        if !status.contains("install ok installed") {
            continue;
        }
        if name.starts_with("linux-image-") {
            out.push(name);
        }
    }
    out
}

fn scan() -> ScanResult {
    let running = running_version();
    let latest = latest_version();
    let mut kernels = Vec::new();

    for package in installed_kernel_packages() {
        let Some(version) = package.strip_prefix("linux-image-") else { continue };
        let vmlinuz = Path::new("/boot").join(format!("vmlinuz-{version}"));
        if !vmlinuz.is_file() {
            continue;
        }
        let mut size_bytes = fs::metadata(&vmlinuz).map(|m| m.len()).unwrap_or(0);
        size_bytes += fs::metadata(Path::new("/boot").join(format!("initrd.img-{version}"))).map(|m| m.len()).unwrap_or(0);
        size_bytes += dir_size(&Path::new("/lib/modules").join(version));

        kernels.push(KernelEntry {
            package: package.clone(),
            version: version.to_string(),
            size_bytes,
            is_running: version == running,
            is_latest: version == latest,
        });
    }
    kernels.sort_by_key(|e| std::cmp::Reverse(e.size_bytes));

    ScanResult { running, latest, kernels }
}

fn main() {
    let mut line = String::new();
    let output = match io::stdin().lock().read_line(&mut line) {
        Ok(0) => serde_json::to_string(&Response::<()>::Err {
            ok: false,
            error: "no command received on stdin".into(),
        }),
        Ok(_) => match serde_json::from_str::<Request>(line.trim()) {
            Ok(Request::Scan) => serde_json::to_string(&ok(scan())),
            Err(e) => serde_json::to_string(&Response::<()>::Err { ok: false, error: format!("invalid request: {e}") }),
        },
        Err(e) => serde_json::to_string(&Response::<()>::Err {
            ok: false,
            error: format!("failed to read stdin: {e}"),
        }),
    };
    println!("{}", output.expect("response must serialize"));
    io::stdout().flush().ok();
}
