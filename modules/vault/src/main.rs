//! vault sidecar: local encrypted password manager.
//!
//! Unlike every other sidecar in this app, this one is NOT spawn-per-
//! request — it needs to hold the real encryption key in memory across
//! many actions (list entries, view one, add one) without re-fetching it
//! from the OS keychain or re-asking for the PIN on every click. So this
//! process stays alive for as long as the vault is unlocked: the Tauri
//! side spawns it once, keeps its stdin/stdout pipes open, and sends one
//! JSON request line per action for as long as the session lasts, closing
//! it (or sending {"cmd":"lock"} then leaving it running locked) when the
//! user locks the vault or the app exits.
//!
//! Protocol — one JSON line in, one JSON line out, repeated for the life of
//! the process:
//!   {"cmd":"status"}
//!   {"cmd":"create","pin":"123456"}
//!   {"cmd":"unlock","pin":"123456"}
//!   {"cmd":"lock"}
//!   {"cmd":"change_pin","old_pin":"123456","new_pin":"654321"}
//!   {"cmd":"list_structure"}
//!   {"cmd":"list_templates"}
//!   {"cmd":"get_entry","id":1}
//!   {"cmd":"add_entry","folder_id":1,"title":"...","template_id":1,"fields":{...}}
//!   {"cmd":"update_entry","id":1,"title":"...","template_id":1,"fields":{...}}
//!   {"cmd":"delete_entry","id":1}
//!   {"cmd":"move_entry","id":1,"new_folder_id":2}
//!   {"cmd":"add_folder","name":"...","parent_id":1}
//!   {"cmd":"delete_folder","id":2}
//!   {"cmd":"generate_password","length":20,"upper":true,"lower":true,"digits":true,"symbols":true}
//!   {"cmd":"estimate_strength","password":"..."}
//!   {"cmd":"security_audit"}
//!
//! See crypto.rs and os_keychain.rs for the encryption design (a random key
//! in OS-managed secure storage, gated by a 6-digit PIN that never derives
//! or touches the key itself) and store.rs for the SQLite schema, the PIN
//! lockout, and per-entry encryption.
//!
//! v1 scope: this is a fresh vault, not a migration of the old
//! Password_menager project's vault.db — that was a deliberate choice, not
//! an oversight. The decoy/duress vault concept from the old code (present
//! there but never actually wired into any unlock flow) is not implemented
//! here either, also deliberate — revisit both later if wanted.

mod crypto;
mod os_keychain;
mod store;

use std::io::{self, BufRead, Write};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Map;

use store::Vault;

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Request {
    Status,
    Create { pin: String },
    Unlock { pin: String },
    Lock,
    ChangePin { old_pin: String, new_pin: String },
    ListStructure,
    ListTemplates,
    GetEntry { id: i64 },
    AddEntry { folder_id: i64, title: String, template_id: Option<i64>, fields: Map<String, serde_json::Value> },
    UpdateEntry { id: i64, title: String, template_id: Option<i64>, fields: Map<String, serde_json::Value> },
    DeleteEntry { id: i64 },
    MoveEntry { id: i64, new_folder_id: i64 },
    AddFolder { name: String, parent_id: i64 },
    DeleteFolder { id: i64 },
    GeneratePassword { length: usize, upper: bool, lower: bool, digits: bool, symbols: bool },
    EstimateStrength { password: String },
    SecurityAudit,
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

fn respond<T: Serialize>(result: Result<T, String>) -> String {
    let payload = match result {
        Ok(data) => serde_json::to_string(&ok(data)),
        Err(e) => serde_json::to_string(&Response::<()>::Err { ok: false, error: e }),
    };
    payload.expect("response must serialize")
}

fn vault_path() -> PathBuf {
    if cfg!(target_os = "macos") {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        return PathBuf::from(home).join("Library/Application Support/posma/vault.db");
    }
    if cfg!(target_os = "windows") {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
        return PathBuf::from(appdata).join("posma/vault.db");
    }
    // Linux (and fallback): XDG data dir.
    let base = std::env::var("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into())).join(".local/share"));
    base.join("posma").join("vault.db")
}

fn handle(vault: &mut Vault, line: &str) -> String {
    let request: Request = match serde_json::from_str(line) {
        Ok(r) => r,
        Err(e) => return respond::<()>(Err(format!("invalid request: {e}"))),
    };

    match request {
        Request::Status => respond(Ok(serde_json::json!({ "initialized": vault.is_initialized(), "unlocked": vault.is_unlocked() }))),
        Request::Create { pin } => respond(vault.create(&pin).map(|_| true)),
        Request::Unlock { pin } => respond(vault.unlock(&pin)),
        Request::Lock => {
            vault.lock();
            respond(Ok(true))
        }
        Request::ChangePin { old_pin, new_pin } => respond(vault.change_pin(&old_pin, &new_pin).map(|_| true)),
        Request::ListStructure => respond(vault.list_structure()),
        Request::ListTemplates => respond(vault.list_templates()),
        Request::GetEntry { id } => respond(vault.get_entry(id)),
        Request::AddEntry { folder_id, title, template_id, fields } => respond(vault.add_entry(folder_id, &title, template_id, &fields)),
        Request::UpdateEntry { id, title, template_id, fields } => respond(vault.update_entry(id, &title, template_id, &fields).map(|_| true)),
        Request::DeleteEntry { id } => respond(vault.delete_entry(id).map(|_| true)),
        Request::MoveEntry { id, new_folder_id } => respond(vault.move_entry(id, new_folder_id).map(|_| true)),
        Request::AddFolder { name, parent_id } => respond(vault.add_folder(&name, parent_id)),
        Request::DeleteFolder { id } => respond(vault.delete_folder(id).map(|_| true)),
        Request::GeneratePassword { length, upper, lower, digits, symbols } => {
            respond(crypto::generate_password(&crypto::GeneratorOptions { length, upper, lower, digits, symbols }))
        }
        Request::EstimateStrength { password } => respond(Ok::<u8, String>(crypto::estimate_strength(&password))),
        Request::SecurityAudit => respond(vault.security_audit()),
    }
}

fn main() {
    let path = vault_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut vault = match Vault::open(&path) {
        Ok(v) => v,
        Err(e) => {
            println!("{}", respond::<()>(Err(e)));
            io::stdout().flush().ok();
            return;
        }
    };

    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        println!("{}", handle(&mut vault, &line));
        io::stdout().flush().ok();
    }
}
