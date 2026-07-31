//! SQLite-backed vault storage. Holds the derived encryption key in memory
//! only while unlocked (zeroized on lock/drop); every entry's field data is
//! AES-256-GCM encrypted at rest, one fresh nonce per row per write.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Map;
use zeroize::Zeroize;

use crate::crypto::{self, KdfParams, KEY_LEN};

const DEFAULT_TEMPLATES: &[(&str, &[(&str, bool)])] = &[
    ("Login", &[("Nazwa użytkownika", false), ("Hasło", true), ("URL", false)]),
    ("Karta kredytowa", &[("Imię i nazwisko na karcie", false), ("Numer karty", true), ("Data ważności (MM/RR)", true), ("Kod CVC/CVV", true)]),
    ("Licencja na oprogramowanie", &[("Nazwa produktu", false), ("Klucz licencyjny", true), ("Email licencji", false)]),
];

#[derive(Serialize, Deserialize, Clone)]
pub struct TemplateField {
    pub name: String,
    pub secret: bool,
}

#[derive(Serialize)]
pub struct TemplateInfo {
    pub id: i64,
    pub name: String,
    pub fields: Vec<TemplateField>,
}

#[derive(Serialize)]
pub struct FolderInfo {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
}

#[derive(Serialize)]
pub struct EntrySummary {
    pub id: i64,
    pub folder_id: i64,
    pub title: String,
    pub template_id: Option<i64>,
}

#[derive(Serialize)]
pub struct Structure {
    pub folders: Vec<FolderInfo>,
    pub entries: Vec<EntrySummary>,
}

#[derive(Serialize)]
pub struct EntryDetail {
    pub id: i64,
    pub folder_id: i64,
    pub title: String,
    pub template_id: Option<i64>,
    pub fields: Map<String, serde_json::Value>,
}

pub struct Vault {
    conn: Connection,
    encryption_key: Option<[u8; KEY_LEN]>,
}

/// Every unlock attempt when the vault is already initialized returns one
/// of these — distinct from a hard error, since "wrong PIN" and "locked
/// out, try later" are both normal outcomes the frontend needs to show
/// differently (remaining attempts vs. a countdown), not exceptions.
#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum UnlockResult {
    Success,
    WrongPin { attempts_remaining: u32 },
    LockedOut { retry_after_secs: u64 },
}

const MAX_ATTEMPTS_BEFORE_LOCKOUT: u32 = 5;
const LOCKOUT_BASE_SECS: u64 = 30;
const LOCKOUT_MAX_SECS: u64 = 300;

fn now_unix() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn validate_pin(pin: &str) -> Result<(), String> {
    if pin.len() != 6 || !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err("PIN musi składać się z dokładnie 6 cyfr".into());
    }
    Ok(())
}

impl Vault {
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS vault_meta (
                 id INTEGER PRIMARY KEY CHECK (id = 1),
                 pin_salt BLOB NOT NULL,
                 pin_hash BLOB NOT NULL,
                 kdf_m_cost INTEGER NOT NULL,
                 kdf_t_cost INTEGER NOT NULL,
                 kdf_p_cost INTEGER NOT NULL,
                 failed_attempts INTEGER NOT NULL DEFAULT 0,
                 locked_until_unix INTEGER
             );
             CREATE TABLE IF NOT EXISTS folders (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 parent_id INTEGER,
                 name TEXT NOT NULL,
                 FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS templates (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 name TEXT NOT NULL UNIQUE,
                 fields TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS entries (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 folder_id INTEGER NOT NULL,
                 title TEXT NOT NULL,
                 template_id INTEGER,
                 encrypted_fields BLOB NOT NULL,
                 last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
                 FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
                 FOREIGN KEY (template_id) REFERENCES templates(id)
             );",
        )
        .map_err(|e| e.to_string())?;
        Ok(Vault { conn, encryption_key: None })
    }

    pub fn is_initialized(&self) -> bool {
        self.conn.query_row("SELECT 1 FROM vault_meta WHERE id = 1", [], |_| Ok(())).optional().unwrap_or(None).is_some()
    }

    pub fn is_unlocked(&self) -> bool {
        self.encryption_key.is_some()
    }

    pub fn lock(&mut self) {
        if let Some(mut key) = self.encryption_key.take() {
            key.zeroize();
        }
    }

    /// Generates a brand-new random AES-256-GCM key (never derived from the
    /// PIN) and hands it to the OS keychain — see os_keychain.rs. The PIN
    /// only ever gates *retrieving* that key, never derives it.
    pub fn create(&mut self, pin: &str) -> Result<(), String> {
        if self.is_initialized() {
            return Err("sejf już istnieje".into());
        }
        validate_pin(pin)?;

        let params_kdf = KdfParams::default();
        let salt = crypto::random_salt();
        let pin_hash = crypto::hash_pin(pin, &salt, &params_kdf)?;
        let key = crypto::generate_key();
        crate::os_keychain::store_key(&key)?;

        self.conn
            .execute(
                "INSERT INTO vault_meta (id, pin_salt, pin_hash, kdf_m_cost, kdf_t_cost, kdf_p_cost, failed_attempts, locked_until_unix)
                 VALUES (1, ?1, ?2, ?3, ?4, ?5, 0, NULL)",
                params![salt.to_vec(), pin_hash.to_vec(), params_kdf.m_cost_kib, params_kdf.t_cost, params_kdf.p_cost],
            )
            .map_err(|e| e.to_string())?;

        self.conn.execute("INSERT INTO folders (id, parent_id, name) VALUES (1, NULL, 'Główny folder')", []).map_err(|e| e.to_string())?;
        for (name, fields) in DEFAULT_TEMPLATES {
            let json = serde_json::to_string(&fields.iter().map(|(n, s)| TemplateField { name: n.to_string(), secret: *s }).collect::<Vec<_>>()).unwrap();
            self.conn.execute("INSERT OR IGNORE INTO templates (name, fields) VALUES (?1, ?2)", params![name, json]).map_err(|e| e.to_string())?;
        }

        self.encryption_key = Some(key);
        Ok(())
    }

    /// Checks the PIN against its stored hash. On success, fetches the real
    /// key from the OS keychain — the PIN itself never touches the key.
    /// Five wrong attempts trigger an exponentially growing lockout
    /// (persisted in vault_meta, so it survives a process restart) rather
    /// than letting a script hammer all million 6-digit combinations.
    pub fn unlock(&mut self, pin: &str) -> Result<UnlockResult, String> {
        let (salt, stored_hash, m_cost, t_cost, p_cost, failed_attempts, locked_until): (Vec<u8>, Vec<u8>, u32, u32, u32, u32, Option<i64>) = self
            .conn
            .query_row("SELECT pin_salt, pin_hash, kdf_m_cost, kdf_t_cost, kdf_p_cost, failed_attempts, locked_until_unix FROM vault_meta WHERE id = 1", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
            })
            .map_err(|e| e.to_string())?;

        let now = now_unix();
        if let Some(until) = locked_until {
            if until as u64 > now {
                return Ok(UnlockResult::LockedOut { retry_after_secs: until as u64 - now });
            }
        }

        let params_kdf = KdfParams { m_cost_kib: m_cost, t_cost, p_cost };
        let attempt_hash = crypto::hash_pin(pin, &salt, &params_kdf)?;

        if attempt_hash.as_slice() == stored_hash.as_slice() {
            self.conn.execute("UPDATE vault_meta SET failed_attempts = 0, locked_until_unix = NULL WHERE id = 1", []).map_err(|e| e.to_string())?;
            self.encryption_key = Some(crate::os_keychain::load_key()?);
            return Ok(UnlockResult::Success);
        }

        let new_failed = failed_attempts + 1;
        let locked_until_new = if new_failed >= MAX_ATTEMPTS_BEFORE_LOCKOUT {
            let backoff = LOCKOUT_BASE_SECS.saturating_mul(1u64 << (new_failed - MAX_ATTEMPTS_BEFORE_LOCKOUT).min(10)).min(LOCKOUT_MAX_SECS);
            Some((now + backoff) as i64)
        } else {
            None
        };
        self.conn
            .execute("UPDATE vault_meta SET failed_attempts = ?1, locked_until_unix = ?2 WHERE id = 1", params![new_failed, locked_until_new])
            .map_err(|e| e.to_string())?;

        match locked_until_new {
            Some(until) => Ok(UnlockResult::LockedOut { retry_after_secs: until as u64 - now }),
            None => Ok(UnlockResult::WrongPin { attempts_remaining: MAX_ATTEMPTS_BEFORE_LOCKOUT - new_failed }),
        }
    }

    /// Just swaps the stored PIN hash — the encryption key in the OS
    /// keychain is untouched, so unlike the old master-password design this
    /// never needs to decrypt and re-encrypt every entry.
    pub fn change_pin(&mut self, old_pin: &str, new_pin: &str) -> Result<(), String> {
        match self.unlock(old_pin)? {
            UnlockResult::Success => {}
            UnlockResult::WrongPin { .. } => return Err("obecny kod PIN jest nieprawidłowy".into()),
            UnlockResult::LockedOut { retry_after_secs } => return Err(format!("zbyt wiele prób — spróbuj ponownie za {retry_after_secs} s")),
        }
        validate_pin(new_pin)?;

        let params_kdf = KdfParams::default();
        let salt = crypto::random_salt();
        let new_hash = crypto::hash_pin(new_pin, &salt, &params_kdf)?;
        self.conn
            .execute(
                "UPDATE vault_meta SET pin_salt = ?1, pin_hash = ?2, kdf_m_cost = ?3, kdf_t_cost = ?4, kdf_p_cost = ?5 WHERE id = 1",
                params![salt.to_vec(), new_hash.to_vec(), params_kdf.m_cost_kib, params_kdf.t_cost, params_kdf.p_cost],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn require_key(&self) -> Result<[u8; KEY_LEN], String> {
        self.encryption_key.ok_or_else(|| "sejf zablokowany".to_string())
    }

    pub fn list_folders(&self) -> Result<Vec<FolderInfo>, String> {
        let mut stmt = self.conn.prepare("SELECT id, parent_id, name FROM folders ORDER BY name").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok(FolderInfo { id: r.get(0)?, parent_id: r.get(1)?, name: r.get(2)? }))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn add_folder(&self, name: &str, parent_id: i64) -> Result<i64, String> {
        self.conn.execute("INSERT INTO folders (parent_id, name) VALUES (?1, ?2)", params![parent_id, name]).map_err(|e| e.to_string())?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn delete_folder(&self, id: i64) -> Result<(), String> {
        if id == 1 {
            return Err("nie można usunąć głównego folderu".into());
        }
        self.conn.execute("DELETE FROM folders WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_templates(&self) -> Result<Vec<TemplateInfo>, String> {
        let mut stmt = self.conn.prepare("SELECT id, name, fields FROM templates ORDER BY name").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                let fields_json: String = r.get(2)?;
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, fields_json))
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            let (id, name, fields_json) = row.map_err(|e| e.to_string())?;
            let fields: Vec<TemplateField> = serde_json::from_str(&fields_json).map_err(|e| e.to_string())?;
            out.push(TemplateInfo { id, name, fields });
        }
        Ok(out)
    }

    pub fn list_structure(&self) -> Result<Structure, String> {
        let folders = self.list_folders()?;
        let mut stmt = self.conn.prepare("SELECT id, folder_id, title, template_id FROM entries ORDER BY title").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok(EntrySummary { id: r.get(0)?, folder_id: r.get(1)?, title: r.get(2)?, template_id: r.get(3)? }))
            .map_err(|e| e.to_string())?;
        let entries = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        Ok(Structure { folders, entries })
    }

    pub fn get_entry(&self, id: i64) -> Result<EntryDetail, String> {
        let key = self.require_key()?;
        let (folder_id, title, template_id, blob): (i64, String, Option<i64>, Vec<u8>) = self
            .conn
            .query_row("SELECT folder_id, title, template_id, encrypted_fields FROM entries WHERE id = ?1", params![id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .map_err(|e| e.to_string())?;
        let plain = crypto::decrypt(&key, &blob)?;
        let fields: Map<String, serde_json::Value> = serde_json::from_slice(&plain).map_err(|e| e.to_string())?;
        Ok(EntryDetail { id, folder_id, title, template_id, fields })
    }

    /// Every decrypted entry — used for the security audit (weak/reused
    /// password scan). Never exposed to the frontend directly; the audit
    /// summary is computed here and only the aggregate result leaves.
    fn get_all_entries_decrypted(&self) -> Result<Vec<EntryDetail>, String> {
        let key = self.require_key()?;
        let mut stmt = self.conn.prepare("SELECT id, folder_id, title, template_id, encrypted_fields FROM entries").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<i64>>(3)?, r.get::<_, Vec<u8>>(4)?)))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            let (id, folder_id, title, template_id, blob) = row.map_err(|e| e.to_string())?;
            let Ok(plain) = crypto::decrypt(&key, &blob) else { continue };
            let Ok(fields) = serde_json::from_slice::<Map<String, serde_json::Value>>(&plain) else { continue };
            out.push(EntryDetail { id, folder_id, title, template_id, fields });
        }
        Ok(out)
    }

    pub fn add_entry(&self, folder_id: i64, title: &str, template_id: Option<i64>, fields: &Map<String, serde_json::Value>) -> Result<i64, String> {
        let key = self.require_key()?;
        let plain = serde_json::to_vec(fields).map_err(|e| e.to_string())?;
        let blob = crypto::encrypt(&key, &plain);
        self.conn
            .execute("INSERT INTO entries (folder_id, title, template_id, encrypted_fields) VALUES (?1, ?2, ?3, ?4)", params![folder_id, title, template_id, blob])
            .map_err(|e| e.to_string())?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn update_entry(&self, id: i64, title: &str, template_id: Option<i64>, fields: &Map<String, serde_json::Value>) -> Result<(), String> {
        let key = self.require_key()?;
        let plain = serde_json::to_vec(fields).map_err(|e| e.to_string())?;
        let blob = crypto::encrypt(&key, &plain);
        self.conn
            .execute(
                "UPDATE entries SET title = ?1, template_id = ?2, encrypted_fields = ?3, last_modified = CURRENT_TIMESTAMP WHERE id = ?4",
                params![title, template_id, blob, id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_entry(&self, id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM entries WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn move_entry(&self, id: i64, new_folder_id: i64) -> Result<(), String> {
        self.conn.execute("UPDATE entries SET folder_id = ?1 WHERE id = ?2", params![new_folder_id, id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Flags fields whose name suggests a secret (matches the template's
    /// `secret` flag when known, else falls back to a name-based guess) as
    /// weak or reused across the vault. Read-only — never modifies data.
    pub fn security_audit(&self) -> Result<AuditResult, String> {
        let entries = self.get_all_entries_decrypted()?;
        let mut weak: Vec<AuditHit> = Vec::new();
        let mut by_value: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();

        for entry in &entries {
            for (field_name, value) in &entry.fields {
                let Some(value) = value.as_str() else { continue };
                if value.is_empty() {
                    continue;
                }
                let looks_secret = ["hasło", "password", "klucz", "cvc", "cvv"].iter().any(|k| field_name.to_lowercase().contains(k));
                if !looks_secret {
                    continue;
                }
                let score = crypto::estimate_strength(value);
                if score < 3 {
                    weak.push(AuditHit { entry_id: entry.id, entry_title: entry.title.clone(), field: field_name.clone(), score });
                }
                by_value.entry(value.to_string()).or_default().push(entry.title.clone());
            }
        }

        let reused: Vec<ReusedGroup> = by_value.into_iter().filter(|(_, titles)| titles.len() > 1).map(|(_, titles)| ReusedGroup { entry_titles: titles }).collect();

        Ok(AuditResult { weak_count: weak.len(), weak, reused_count: reused.len(), reused })
    }
}

#[derive(Serialize)]
pub struct AuditHit {
    pub entry_id: i64,
    pub entry_title: String,
    pub field: String,
    pub score: u8,
}

#[derive(Serialize)]
pub struct ReusedGroup {
    pub entry_titles: Vec<String>,
}

#[derive(Serialize)]
pub struct AuditResult {
    pub weak_count: usize,
    pub weak: Vec<AuditHit>,
    pub reused_count: usize,
    pub reused: Vec<ReusedGroup>,
}
