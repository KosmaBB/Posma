//! bloatware sidecar (Windows): the Store apps installed for this account
//! that Windows lets be removed, with the ones it ships preinstalled marked.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"scan"} -> {"ok":true,"data":{"apps":[{"name":"Microsoft.BingWeather",
//!                      "package":"Microsoft.BingWeather_4.53.51922.0_x64__8wekyb3d8bbwe",
//!                      "preinstalled":true}],"error":null}}
//!   {"cmd":"remove","packages":["Microsoft.BingWeather_…"]}
//!                   -> {"ok":true,"data":{"removed":[…],"errors":[…]}}
//!
//! Both run as the user: an app installed for this account is the
//! account's to remove, and an elevated Remove-AppxPackage would act on the
//! administrator's account instead — another one when a standard user
//! types an administrator's password. The core makes a restore point first.

use std::collections::HashSet;
use std::io::{self, BufRead, Write};
use std::process::Command;

use serde::{Deserialize, Serialize};

/// Frameworks and what Windows marks non-removable are left out, and so is
/// anything not from the Store — system components are signed otherwise.
const LIST_SCRIPT: &str = "Get-AppxPackage | Where-Object { -not $_.IsFramework -and -not $_.NonRemovable \
     -and $_.SignatureKind -eq 'Store' } | Select-Object Name, PackageFullName | ConvertTo-Json -Compress";

/// What Windows or a PC maker installs for every account unasked. Only
/// marked — nothing is removed without a pick. Prefixes, because the
/// promotional ones carry a version or a publisher in their names.
const PREINSTALLED: &[&str] = &[
    "Microsoft.BingNews",
    "Microsoft.BingWeather",
    "Microsoft.BingSearch",
    "Microsoft.GetHelp",
    "Microsoft.Getstarted",
    "Microsoft.MicrosoftSolitaireCollection",
    "Microsoft.MicrosoftOfficeHub",
    "Microsoft.People",
    "Microsoft.WindowsFeedbackHub",
    "Microsoft.ZuneMusic",
    "Microsoft.ZuneVideo",
    "Microsoft.WindowsMaps",
    "Microsoft.Todos",
    "Microsoft.PowerAutomateDesktop",
    "Microsoft.549981C3F5F10",
    "Microsoft.SkypeApp",
    "Microsoft.MixedReality.Portal",
    "Microsoft.Microsoft3DViewer",
    "Microsoft.windowscommunicationsapps",
    "Clipchamp.Clipchamp",
    "king.com.",
    "Disney.",
    "Facebook.",
    "AmazonVideo.PrimeVideo",
    "BytedancePte.Ltd.TikTok",
];

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Scan,
    Remove { packages: Vec<String> },
}

#[derive(Deserialize)]
struct Package {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "PackageFullName")]
    package: String,
}

#[derive(Serialize, Debug, PartialEq)]
struct App {
    name: String,
    package: String,
    preinstalled: bool,
}

#[derive(Serialize)]
struct ScanResult {
    /// Preinstalled first, then by name.
    apps: Vec<App>,
    error: Option<String>,
}

#[derive(Serialize, Default)]
struct RemoveResult {
    removed: Vec<String>,
    errors: Vec<String>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Response<T: Serialize> {
    Ok { ok: bool, data: T },
    Err { ok: bool, error: String },
}

fn is_preinstalled(name: &str) -> bool {
    PREINSTALLED.iter().any(|p| name.get(..p.len()).is_some_and(|head| head.eq_ignore_ascii_case(p)))
}

/// ConvertTo-Json writes a lone object for one package and nothing at all
/// for none, rather than an array either time.
fn parse_apps(json: &str) -> Result<Vec<App>, String> {
    let json = json.trim().trim_start_matches('\u{feff}');
    let packages: Vec<Package> = match json.chars().next() {
        None => Vec::new(),
        Some('[') => serde_json::from_str(json).map_err(|e| e.to_string())?,
        Some(_) => vec![serde_json::from_str(json).map_err(|e| e.to_string())?],
    };
    let mut apps: Vec<App> = packages
        .into_iter()
        .map(|p| App { preinstalled: is_preinstalled(&p.name), name: p.name, package: p.package })
        .collect();
    apps.sort_by(|a, b| b.preinstalled.cmp(&a.preinstalled).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(apps)
}

/// UTF-8, or a translated error message arrives in the OEM code page.
fn powershell(script: &str) -> Result<String, String> {
    let script = format!("[Console]::OutputEncoding = [Text.Encoding]::UTF8; {script}");
    match Command::new("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", &script]).output() {
        Ok(out) if out.status.success() => Ok(String::from_utf8_lossy(&out.stdout).into_owned()),
        Ok(out) => Err(String::from_utf8_lossy(&out.stderr).trim().to_string()),
        Err(e) => Err(format!("powershell.exe: {e}")),
    }
}

fn scan() -> ScanResult {
    match powershell(LIST_SCRIPT).and_then(|json| parse_apps(&json).map_err(|e| format!("nie udało się odczytać listy aplikacji: {e}"))) {
        Ok(apps) => ScanResult { apps, error: None },
        Err(e) => ScanResult { apps: Vec::new(), error: Some(e) },
    }
}

/// One script for every package, each name in single quotes. Only names
/// the scan offers right now get here, and those hold no quote. No double
/// quotes either: Windows PowerShell 5.1 does not read them back reliably
/// from its command line, so the tab is `[char]9`.
fn remove_script(packages: &[String]) -> String {
    let list = packages.iter().map(|p| format!("'{p}'")).collect::<Vec<_>>().join(",");
    format!(
        "foreach ($p in @({list})) {{ try {{ Remove-AppxPackage -Package $p -ErrorAction Stop; 'ok' + [char]9 + $p }} \
         catch {{ 'err' + [char]9 + $p + [char]9 + ($_.Exception.Message -replace '\\s+', ' ') }} }}"
    )
}

/// What the script printed, one tab-separated line per package.
fn read_removal(output: &str) -> RemoveResult {
    let mut result = RemoveResult::default();
    for line in output.lines() {
        match line.trim_end().split('\t').collect::<Vec<_>>()[..] {
            ["ok", package] => result.removed.push(package.to_string()),
            ["err", package, reason, ..] => result.errors.push(format!("{package}: {reason}")),
            _ => {}
        }
    }
    result
}

/// The acting side checks again: a package goes only if it is on the list
/// the scan would offer now — removable, not a framework, from the Store.
fn remove(packages: Vec<String>) -> RemoveResult {
    let offered: HashSet<String> = match powershell(LIST_SCRIPT).and_then(|json| parse_apps(&json)) {
        Ok(apps) => apps.into_iter().map(|a| a.package).collect(),
        Err(e) => return RemoveResult { errors: vec![format!("nie udało się sprawdzić listy aplikacji: {e}")], ..Default::default() },
    };
    let (wanted, refused): (Vec<String>, Vec<String>) = packages.into_iter().partition(|p| offered.contains(p));
    let mut result = if wanted.is_empty() {
        RemoveResult::default()
    } else {
        powershell(&remove_script(&wanted)).map(|out| read_removal(&out)).unwrap_or_else(|e| RemoveResult { errors: vec![e], ..Default::default() })
    };
    result.errors.extend(refused.into_iter().map(|p| format!("{p}: nie ma go na liście aplikacji do usunięcia — pominięto")));
    result
}

fn main() {
    let mut line = String::new();
    let output = match io::stdin().lock().read_line(&mut line) {
        Ok(0) => serde_json::to_string(&Response::<()>::Err { ok: false, error: "no command received on stdin".into() }),
        Ok(_) => match serde_json::from_str::<Request>(line.trim()) {
            Ok(Request::Scan) => serde_json::to_string(&Response::Ok { ok: true, data: scan() }),
            Ok(Request::Remove { packages }) => serde_json::to_string(&Response::Ok { ok: true, data: remove(packages) }),
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

    const WEATHER: &str = r#"{"Name":"Microsoft.BingWeather","PackageFullName":"Microsoft.BingWeather_4.53.51922.0_x64__8wekyb3d8bbwe"}"#;
    const TERMINAL: &str = r#"{"Name":"Microsoft.WindowsTerminal","PackageFullName":"Microsoft.WindowsTerminal_1.21.2361.0_x64__8wekyb3d8bbwe"}"#;

    /// The three shapes ConvertTo-Json writes, and the preinstalled marked first.
    #[test]
    fn every_shape_powershell_writes_is_read() {
        let both = parse_apps(&format!("\u{feff}[{TERMINAL},{WEATHER}]\r\n")).unwrap();
        assert_eq!(both.iter().map(|a| (a.name.as_str(), a.preinstalled)).collect::<Vec<_>>(), [
            ("Microsoft.BingWeather", true),
            ("Microsoft.WindowsTerminal", false)
        ]);
        assert_eq!(parse_apps(TERMINAL).unwrap().len(), 1);
        assert!(parse_apps("").unwrap().is_empty());
        assert!(is_preinstalled("king.com.CandyCrushSaga") && is_preinstalled("microsoft.WINDOWSCOMMUNICATIONSAPPS"));
    }

    /// Each package in its own quotes, and the script's answer read back
    /// per package — a reason may itself contain a tab-free colon.
    #[test]
    fn removal_is_one_script_read_back_per_package() {
        let script = remove_script(&["A_1_x64__p".into(), "B_2_x64__p".into()]);
        assert!(script.starts_with("foreach ($p in @('A_1_x64__p','B_2_x64__p'))") && !script.contains('"'), "{script}");
        let read = read_removal("ok\tA_1_x64__p\r\nerr\tB_2_x64__p\tDeployment failed: 0x80073CFA\r\n");
        assert_eq!(read.removed, ["A_1_x64__p"]);
        assert_eq!(read.errors, ["B_2_x64__p: Deployment failed: 0x80073CFA"]);
    }
}
