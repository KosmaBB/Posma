//! winget-ui sidecar (Windows): the applications winget can update.
//! Updating them is the broker's `pkg_upgrade`.
//!
//! Protocol (one JSON line on stdin -> one JSON line on stdout):
//!   {"cmd":"scan"} -> {"ok":true,"data":{"upgrades":[{"name":"Microsoft Edge",
//!                      "id":"Microsoft.Edge","version":"118.0.2088","available":"119.0.2151",
//!                      "source":"winget","truncated":false}],"error":null}}
//!
//! winget has no machine-readable listing of updates, so its table is read
//! by the columns its header lines up — in whatever language it prints.

use std::io::{self, BufRead, Write};
use std::process::Command;

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Scan,
}

#[derive(Serialize, Debug, PartialEq)]
struct Upgrade {
    name: String,
    id: String,
    version: String,
    available: String,
    source: String,
    /// winget cut the id to fit its column; it cannot be passed back.
    truncated: bool,
}

#[derive(Serialize)]
struct ScanResult {
    upgrades: Vec<Upgrade>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Response<T: Serialize> {
    Ok { ok: bool, data: T },
    Err { ok: bool, error: String },
}

/// Where each column begins: every word of the header that follows a space.
fn column_starts(header: &[char]) -> Vec<usize> {
    (0..header.len()).filter(|&i| header[i] != ' ' && (i == 0 || header[i - 1] == ' ')).collect()
}

/// The first table winget prints — the one below its header and rule.
/// What follows the first blank line (packages pinned or needing explicit
/// targeting) is a second table, and not offered.
// shortcut: columns are counted in characters, so a name in a wide script
// (CJK) shifts the row; reading `winget export` or the COM API would not.
fn parse_upgrades(output: &str) -> Vec<Upgrade> {
    // Progress spinners overwrite themselves with `\r`; the last part of a
    // line is what a terminal would show.
    let lines: Vec<&str> = output.lines().map(|l| l.rsplit('\r').next().unwrap_or(l)).collect();
    let Some(rule) = lines.iter().position(|l| l.trim().len() >= 10 && l.trim().chars().all(|c| c == '-')) else {
        return Vec::new();
    };
    let Some(header) = rule.checked_sub(1).map(|i| lines[i].chars().collect::<Vec<_>>()) else { return Vec::new() };
    let starts = column_starts(&header);
    if starts.len() < 4 {
        return Vec::new();
    }
    let mut upgrades = Vec::new();
    for line in &lines[rule + 1..] {
        let chars: Vec<char> = line.chars().collect();
        let field = |i: usize| -> String {
            let from = starts[i].min(chars.len());
            let to = starts.get(i + 1).copied().unwrap_or(chars.len()).min(chars.len());
            chars[from..to].iter().collect::<String>().trim().to_string()
        };
        let id = field(1);
        // A blank line ends the table, a summary line has nothing under Id.
        if id.is_empty() {
            break;
        }
        upgrades.push(Upgrade {
            name: field(0),
            truncated: id.ends_with('…'),
            id,
            version: field(2),
            available: field(3),
            source: if starts.len() > 4 { field(4) } else { String::new() },
        });
    }
    upgrades
}

fn scan() -> ScanResult {
    let listed = Command::new("winget").args(["upgrade", "--accept-source-agreements", "--disable-interactivity"]).output();
    match listed {
        // Nothing to update ends with an error code and no table, which reads as none.
        Ok(out) => ScanResult { upgrades: parse_upgrades(&String::from_utf8_lossy(&out.stdout)), error: None },
        Err(e) if e.kind() == io::ErrorKind::NotFound => ScanResult {
            upgrades: Vec::new(),
            error: Some("Nie znaleziono winget — zainstaluj „Instalator aplikacji” ze Sklepu Microsoft.".into()),
        },
        Err(e) => ScanResult { upgrades: Vec::new(), error: Some(format!("winget: {e}")) },
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

    /// winget's own output as a redirected run prints it: a spinner, the
    /// table, a summary, then a second table that is not offered.
    #[test]
    fn the_first_table_is_read_by_its_header() {
        let output = "   - \r   \\ \r\
Name                        Id                          Version      Available    Source\r\n\
-----------------------------------------------------------------------------------------\r\n\
Microsoft Edge              Microsoft.Edge              118.0.2088   119.0.2151   winget\r\n\
Visual Studio Code — Insid… Microsoft.VisualStudioCode… 1.84.0       1.85.0       winget\r\n\
2 upgrades available.\r\n\
\r\n\
The following packages have an upgrade available, but require explicit targeting for upgrade:\r\n\
Name   Id       Version Available Source\r\n\
----------------------------------------\r\n\
Pinned Pin.Me   1.0     2.0       winget\r\n";
        let read = parse_upgrades(output);
        assert_eq!(read.len(), 2, "{read:?}");
        assert_eq!(
            read[0],
            Upgrade {
                name: "Microsoft Edge".into(),
                id: "Microsoft.Edge".into(),
                version: "118.0.2088".into(),
                available: "119.0.2151".into(),
                source: "winget".into(),
                truncated: false
            }
        );
        assert!(read[1].truncated && read[1].name.ends_with('…'));
        assert!(parse_upgrades("No installed package found matching input criteria.\r\n").is_empty());
    }

    /// The same table in Polish: the columns come from where the header's
    /// words start, not from what they say.
    #[test]
    fn a_translated_header_reads_the_same() {
        let output = "Nazwa          Identyfikator   Wersja Dostępne Źródło\n\
-----------------------------------------------------\n\
7-Zip          7zip.7zip       23.01  24.08    winget\n";
        let read = parse_upgrades(output);
        assert_eq!((read[0].id.as_str(), read[0].available.as_str(), read[0].source.as_str()), ("7zip.7zip", "24.08", "winget"));
    }
}
