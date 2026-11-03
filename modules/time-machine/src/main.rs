//! time-machine sidecar: the local snapshots macOS keeps on the startup
//! disk between real backups.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"scan"} -> {"ok":true,"data":{"snapshots":["2026-10-19-101500"],"error":null}}
//!
//! Listing needs no privilege. Deleting does, so it is the broker's
//! `delete_local_snapshots`, which reads the list again as root rather than
//! trusting this one — a request only says whether to keep the newest.

use std::io::{self, BufRead, Write};
use std::process::Command;

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Scan,
}

#[derive(Serialize)]
struct ScanResult {
    /// Oldest first — the dates in the names sort as text.
    snapshots: Vec<String>,
    /// What tmutil said when it could not list them.
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Response<T: Serialize> {
    Ok { ok: bool, data: T },
    Err { ok: bool, error: String },
}

/// "com.apple.TimeMachine.2026-10-19-101500.local" -> "2026-10-19-101500",
/// the form `tmutil deletelocalsnapshots` takes.
fn snapshot_dates(listing: &str) -> Vec<String> {
    let mut dates: Vec<String> = listing
        .lines()
        .filter_map(|l| l.trim().strip_prefix("com.apple.TimeMachine."))
        .map(|s| s.trim_end_matches(".local").to_string())
        .collect();
    dates.sort();
    dates
}

fn scan() -> ScanResult {
    match Command::new("/usr/bin/tmutil").args(["listlocalsnapshots", "/"]).output() {
        Ok(out) if out.status.success() => {
            ScanResult { snapshots: snapshot_dates(&String::from_utf8_lossy(&out.stdout)), error: None }
        }
        Ok(out) => {
            let said = String::from_utf8_lossy(&out.stderr).trim().to_string();
            ScanResult { snapshots: Vec::new(), error: Some(if said.is_empty() { "tmutil zakończył się błędem".into() } else { said }) }
        }
        Err(e) => ScanResult { snapshots: Vec::new(), error: Some(format!("tmutil: {e}")) },
    }
}

fn main() {
    let mut line = String::new();
    let output = match io::stdin().lock().read_line(&mut line) {
        Ok(0) => serde_json::to_string(&Response::<()>::Err { ok: false, error: "no command received on stdin".into() }),
        Ok(_) => match serde_json::from_str::<Request>(line.trim()) {
            Ok(Request::Scan) => serde_json::to_string(&Response::Ok { ok: true, data: scan() }),
            Err(e) => serde_json::to_string(&Response::<()>::Err { ok: false, error: format!("invalid request: {e}") }),
        },
        Err(e) => serde_json::to_string(&Response::<()>::Err { ok: false, error: format!("failed to read stdin: {e}") }),
    };
    println!("{}", output.expect("response must serialize"));
    io::stdout().flush().ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// tmutil's listing on macOS 13 and later, with its header line.
    #[test]
    fn snapshots_are_named_by_the_date_tmutil_deletes_them_by() {
        let listing = "Snapshots for disk /:\ncom.apple.TimeMachine.2026-10-19-101500.local\n\
                       com.apple.TimeMachine.2026-10-18-221012.local\ncom.apple.os.update-ABCDEF\n";
        assert_eq!(snapshot_dates(listing), ["2026-10-18-221012", "2026-10-19-101500"]);
        assert!(snapshot_dates("Snapshots for disk /:\n").is_empty());
    }
}
