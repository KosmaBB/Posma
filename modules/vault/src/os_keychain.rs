//! Stores the vault's real encryption key in the OS's own secure credential
//! store — Secret Service (GNOME Keyring / KWallet) on Linux via D-Bus,
//! Keychain on macOS, Credential Manager on Windows — via the cross-platform
//! `keyring` crate. This is the actual security boundary: the key is never
//! written into vault.db or any file this app controls directly, so copying
//! vault.db off the disk yields ciphertext and nothing else.

use base64::{engine::general_purpose::STANDARD as B64, Engine};

use crate::crypto::KEY_LEN;

const SERVICE: &str = "posma-vault";
const ACCOUNT: &str = "encryption-key";

/// Override hook for isolated testing (or, later, multiple vault
/// profiles) — unset in normal operation, so production always resolves
/// to the fixed `ACCOUNT` above and this has no effect.
fn account_name() -> String {
    std::env::var("POSMA_VAULT_KEYCHAIN_ACCOUNT").unwrap_or_else(|_| ACCOUNT.to_string())
}

fn entry_for(service: &str, account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, account).map_err(|e| e.to_string())
}

fn store_key_at(service: &str, account: &str, key: &[u8; KEY_LEN]) -> Result<(), String> {
    entry_for(service, account)?.set_password(&B64.encode(key)).map_err(|e| format!("nie udało się zapisać klucza w magazynie systemowym: {e}"))
}

fn load_key_at(service: &str, account: &str) -> Result<[u8; KEY_LEN], String> {
    let encoded = entry_for(service, account)?.get_password().map_err(|e| format!("nie udało się odczytać klucza z magazynu systemowego: {e}"))?;
    let bytes = B64.decode(encoded.trim()).map_err(|e| e.to_string())?;
    bytes.try_into().map_err(|_| "klucz w magazynie systemowym ma nieprawidłową długość".to_string())
}

pub fn store_key(key: &[u8; KEY_LEN]) -> Result<(), String> {
    store_key_at(SERVICE, &account_name(), key)
}

pub fn load_key() -> Result<[u8; KEY_LEN], String> {
    load_key_at(SERVICE, &account_name())
}

#[allow(dead_code)] // not wired into any request yet — reserved for a future "delete vault" flow
pub fn delete_key() -> Result<(), String> {
    entry_for(SERVICE, &account_name())?.delete_password().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Exercises the real OS Secret Service backend (this crate's whole
    /// point is that it's NOT a file this app controls), but under a
    /// distinct, obviously-disposable service/account name — never the
    /// production `SERVICE`/`ACCOUNT` pair — so this can never collide with
    /// or overwrite a real vault's key. Cleans up after itself either way.
    #[test]
    fn store_and_load_roundtrip_via_real_os_keychain() {
        let service = "posma-vault-TEST-DISPOSABLE";
        let account = "test-key-delete-me";
        let key = crate::crypto::generate_key();

        store_key_at(service, account, &key).expect("store into OS keychain");
        let loaded = load_key_at(service, account).expect("load from OS keychain");
        assert_eq!(key, loaded);

        entry_for(service, account).unwrap().delete_password().expect("clean up disposable test entry");
    }
}
