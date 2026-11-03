//! services sidecar (Windows): the services each profile groups, with the
//! state Windows reports for them. Changing them is the broker's.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"scan"} -> {"ok":true,"data":{"profiles":[{"id":"telemetry","name":"Telemetria",
//!                      "effect":"…","off":false,"services":[{"name":"DiagTrack",
//!                      "display":"Connected User Experiences and Telemetry",
//!                      "running":true,"disabled":false}]}],"error":null}}
//!
//! A service this edition of Windows does not have is left out, and a
//! profile with none of its services present is left out with it.

use std::io::{self, BufRead, Write};
use std::process::Command;

use broker_common::windows_services::PROFILES;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Scan,
}

/// One row of what the script prints. Status and StartType are compared in
/// PowerShell, because ConvertTo-Json writes enums as bare numbers.
#[derive(Deserialize)]
struct Reported {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "DisplayName")]
    display: String,
    #[serde(rename = "Running")]
    running: bool,
    #[serde(rename = "Disabled")]
    disabled: bool,
}

#[derive(Serialize)]
struct ServiceState {
    name: String,
    display: String,
    running: bool,
    disabled: bool,
}

#[derive(Serialize)]
struct ProfileState {
    id: &'static str,
    name: &'static str,
    effect: &'static str,
    /// Every service of the profile present here is disabled.
    off: bool,
    services: Vec<ServiceState>,
}

#[derive(Serialize)]
struct ScanResult {
    profiles: Vec<ProfileState>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Response<T: Serialize> {
    Ok { ok: bool, data: T },
    Err { ok: bool, error: String },
}

/// The names are this module's own constants, so they sit in the quotes as
/// they are; no double quotes, which Windows PowerShell 5.1 reads back
/// unreliably from its command line. UTF-8, or a translated display name
/// arrives in the OEM code page.
fn list_script() -> String {
    let names: Vec<String> = PROFILES.iter().flat_map(|p| p.services).map(|s| format!("'{}'", s.name)).collect();
    format!(
        "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Service -Name {} -ErrorAction SilentlyContinue | Select-Object Name, DisplayName, \
         @{{n='Running';e={{$_.Status -eq 'Running'}}}}, @{{n='Disabled';e={{$_.StartType -eq 'Disabled'}}}} \
         | ConvertTo-Json -Compress",
        names.join(",")
    )
}

/// ConvertTo-Json writes a lone object for one service and nothing for none.
fn parse(json: &str) -> Result<Vec<Reported>, String> {
    let json = json.trim().trim_start_matches('\u{feff}');
    match json.chars().next() {
        None => Ok(Vec::new()),
        Some('[') => serde_json::from_str(json).map_err(|e| e.to_string()),
        Some(_) => serde_json::from_str(json).map(|one| vec![one]).map_err(|e| e.to_string()),
    }
}

fn profiles(mut reported: Vec<Reported>) -> Vec<ProfileState> {
    PROFILES
        .iter()
        .filter_map(|p| {
            let services: Vec<ServiceState> = p
                .services
                .iter()
                .filter_map(|s| {
                    let at = reported.iter().position(|r| r.name.eq_ignore_ascii_case(s.name))?;
                    let r = reported.swap_remove(at);
                    Some(ServiceState { name: s.name.into(), display: r.display, running: r.running, disabled: r.disabled })
                })
                .collect();
            (!services.is_empty()).then(|| ProfileState {
                id: p.id,
                name: p.name,
                effect: p.effect,
                off: services.iter().all(|s| s.disabled),
                services,
            })
        })
        .collect()
}

fn scan() -> ScanResult {
    let listed = Command::new("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", &list_script()]).output();
    let read = match listed {
        Ok(out) if out.status.success() => parse(&String::from_utf8_lossy(&out.stdout)).map_err(|e| format!("nie udało się odczytać usług: {e}")),
        Ok(out) => Err(String::from_utf8_lossy(&out.stderr).trim().to_string()),
        Err(e) => Err(format!("powershell.exe: {e}")),
    };
    match read {
        Ok(reported) => ScanResult { profiles: profiles(reported), error: None },
        Err(e) => ScanResult { profiles: Vec::new(), error: Some(e) },
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

    /// A profile is off only when every service of it present here is
    /// disabled; one with none present is not offered at all.
    #[test]
    fn profiles_follow_what_windows_reports() {
        let json = r#"[{"Name":"DiagTrack","DisplayName":"Telemetry","Running":false,"Disabled":true},
                       {"Name":"dmwappushservice","DisplayName":"WAP","Running":false,"Disabled":true},
                       {"Name":"Spooler","DisplayName":"Print Spooler","Running":true,"Disabled":false}]"#;
        let states = profiles(parse(json).unwrap());
        let by_id = |id: &str| states.iter().find(|p| p.id == id);
        assert!(by_id("telemetry").is_some_and(|p| p.off && p.services.len() == 2));
        assert!(by_id("print").is_some_and(|p| !p.off && p.services.len() == 1), "Fax is absent, Spooler is on");
        assert!(by_id("xbox").is_none());
        assert_eq!(parse(r#"{"Name":"Fax","DisplayName":"Fax","Running":false,"Disabled":false}"#).unwrap().len(), 1);
        assert!(parse("").unwrap().is_empty() && !list_script().contains('"'));
    }
}
