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
//! How kernels are packaged differs by distribution, and so does whether
//! old ones accumulate at all — the shared `distro` crate knows both, and
//! the broker asks it the same questions as root. Where removal makes no
//! sense (one version per package on Arch, automatic purging on openSUSE)
//! the list is still shown, with the reason instead of a remove button.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"scan"}

use std::io::{self, BufRead, Write};

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
    /// Why nothing here can be removed, where that is the case.
    removal_unavailable: Option<String>,
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

fn scan() -> ScanResult {
    let running = distro::running_kernel().unwrap_or_default();
    let (found, removal_unavailable) = match distro::manager() {
        Ok(m) => (distro::kernels(m), m.kernel_removal().err().map(String::from)),
        Err(why) => (Vec::new(), Some(why)),
    };
    // Sorted newest first, so the first one flagged is the highest version.
    let latest = found.iter().find(|k| k.is_latest).map(|k| k.version.clone()).unwrap_or_default();
    let kernels = found
        .into_iter()
        .map(|k| KernelEntry {
            is_running: k.version == running,
            is_latest: k.is_latest,
            package: k.package,
            version: k.version,
            size_bytes: k.size_bytes,
        })
        .collect();

    ScanResult { running, latest, kernels, removal_unavailable }
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
