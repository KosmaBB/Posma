//! The local record of privileged operations Access_plan.md §2 asks for:
//! one JSON line per request a broker answered — when, for whom, what was
//! asked and whether it worked.
//!
//! Written by the transport layer (`serve`), the only place that knows
//! who is asking. A failure to write is reported and nothing more: the
//! operation has already happened, and refusing the next one because the
//! disk is full would block exactly the cleanup that frees it.

use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// In a directory of its own: `clean_system_paths` may delete flat files
/// in /var/log, and the record of what it did must not be one of them.
// shortcut: never rotated. A line is ~200 bytes, so years of use stay
// small; add rotation if the maintenance schedule starts calling the broker.
pub fn log_path() -> PathBuf {
    // ProgramData on the system drive, found from the system rather than
    // from %ProgramData%, which the asking account may have set.
    #[cfg(windows)]
    {
        let drive = crate::guards::windows_dir().and_then(|w| w.ancestors().last().map(PathBuf::from));
        drive.unwrap_or_else(|| PathBuf::from("C:\\")).join("ProgramData").join("POSMA").join("broker.log")
    }
    #[cfg(not(windows))]
    {
        PathBuf::from("/var/log/posma/broker.log")
    }
}

/// File contents rather than a description of the request: large, and
/// nothing a record of who did what needs.
const BULK_FIELDS: &[&str] = &["content", "activate_content"];

/// Appends one entry for `request` and the broker's `response`.
pub fn record(caller: &str, request: &str, response: &str) {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let Some(line) = entry(caller, request, response, now) else { return };
    if let Err(e) = append(&log_path(), &line) {
        eprintln!("nie udało się zapisać dziennika audytu {}: {e}", log_path().display());
    }
}

/// None for the capability probe: it asks what the broker can do and
/// changes nothing.
fn entry(caller: &str, request: &str, response: &str, unix_secs: u64) -> Option<String> {
    let mut request: Value = serde_json::from_str(request.trim())
        // A request the broker could not even parse is worth seeing too.
        .unwrap_or_else(|_| Value::String(request.trim().chars().take(200).collect()));
    if let Some(fields) = request.as_object_mut() {
        if fields.get("op").and_then(Value::as_str) == Some("capabilities") {
            return None;
        }
        for field in BULK_FIELDS {
            fields.remove(*field);
        }
    }

    let response: Value = serde_json::from_str(response).unwrap_or(Value::Null);
    let data = &response["data"];
    // Each result shape says failure its own way: the envelope, an
    // ExecResult's `success`, a CleanResult's `errors`.
    let partial = data["errors"].as_array().filter(|e| !e.is_empty());
    let ok = response["ok"] == true && data["success"] != false && partial.is_none();
    let error = response["error"]
        .as_str()
        .or_else(|| data["error"].as_str())
        .map(Value::from)
        .or_else(|| partial.map(|e| Value::Array(e.clone())));

    Some(json!({ "ts": unix_secs, "caller": caller, "request": request, "ok": ok, "error": error }).to_string())
}

fn append(path: &Path, line: &str) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{line}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(line: Option<String>) -> Value {
        serde_json::from_str(&line.expect("an entry")).expect("valid JSON")
    }

    #[test]
    fn a_write_is_recorded_without_the_file_it_wrote() {
        let request = r#"{"op":"write_system_file","path":"/etc/default/grub","content":"GRUB_TIMEOUT=5\n","keep_backups":2}"#;
        let response = r#"{"ok":true,"data":{"success":true,"output":"","error":null}}"#;
        let e = parsed(entry("uid 1000 (demon)", request, response, 42));
        assert_eq!(e["ts"], 42);
        assert_eq!(e["caller"], "uid 1000 (demon)");
        assert_eq!(e["request"]["path"], "/etc/default/grub");
        assert!(e["request"].get("content").is_none());
        assert_eq!(e["ok"], true);
        assert!(e["error"].is_null());
    }

    #[test]
    fn every_way_of_failing_is_recorded_as_failure() {
        let refused = r#"{"ok":true,"data":{"success":false,"output":"","error":"odmowa: to jest aktywne jądro"}}"#;
        let e = parsed(entry("uid 1000 (pkexec)", r#"{"op":"remove_kernel","package":"linux-image-x"}"#, refused, 1));
        assert_eq!((e["ok"].clone(), e["error"].clone()), (json!(false), json!("odmowa: to jest aktywne jądro")));

        let partial = r#"{"ok":true,"data":{"freed_bytes":10,"removed":1,"errors":["/var/log/x: brak dostępu"]}}"#;
        let e = parsed(entry("u", r#"{"op":"clean_system_paths","paths":["/var/log/a","/var/log/x"]}"#, partial, 1));
        assert_eq!(e["ok"], false);
        assert_eq!(e["error"], json!(["/var/log/x: brak dostępu"]));

        let unparsable = r#"{"ok":false,"error":"invalid request: unknown variant `run_arbitrary_command`"}"#;
        let e = parsed(entry("u", r#"{"op":"run_arbitrary_command","cmd":"rm -rf /"}"#, unparsable, 1));
        assert_eq!(e["ok"], false);
        assert_eq!(e["request"]["op"], "run_arbitrary_command");
    }

    #[test]
    fn the_startup_probe_is_not_recorded() {
        assert!(entry("u", r#"{"op":"capabilities"}"#, r#"{"ok":true,"data":{}}"#, 1).is_none());
    }

    #[test]
    fn entries_accumulate_one_per_line() {
        let dir = std::env::temp_dir().join(format!("posma-audit-test-{}", std::process::id()));
        let path = dir.join("nested").join("broker.log");
        append(&path, "{\"a\":1}").expect("first");
        append(&path, "{\"a\":2}").expect("second");
        assert_eq!(fs::read_to_string(&path).expect("log"), "{\"a\":1}\n{\"a\":2}\n");
        let _ = fs::remove_dir_all(&dir);
    }
}
