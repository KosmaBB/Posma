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

/// The key is stored as base64 text because credential stores hold strings,
/// not arbitrary bytes.
fn encode_key(key: &[u8; KEY_LEN]) -> String {
    B64.encode(key)
}

/// Rejects anything that is not exactly one key's worth of bytes, so a
/// truncated or foreign entry surfaces as an error instead of a key of the
/// wrong size reaching the cipher.
fn decode_key(encoded: &str) -> Result<[u8; KEY_LEN], String> {
    let bytes = B64.decode(encoded.trim()).map_err(|e| e.to_string())?;
    bytes.try_into().map_err(|_| "klucz w magazynie systemowym ma nieprawidłową długość".to_string())
}

fn store_key_at(service: &str, account: &str, key: &[u8; KEY_LEN]) -> Result<(), String> {
    entry_for(service, account)?.set_password(&encode_key(key)).map_err(|e| format!("nie udało się zapisać klucza w magazynie systemowym: {e}"))
}

fn load_key_at(service: &str, account: &str) -> Result<[u8; KEY_LEN], String> {
    let encoded = entry_for(service, account)?.get_password().map_err(|e| format!("nie udało się odczytać klucza z magazynu systemowego: {e}"))?;
    decode_key(&encoded)
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

    #[test]
    fn encoded_key_round_trips() {
        let key = crate::crypto::generate_key();
        assert_eq!(decode_key(&encode_key(&key)).expect("decode"), key);
    }

    #[test]
    fn surrounding_whitespace_is_tolerated() {
        let key = crate::crypto::generate_key();
        let padded = format!("  {}\n", encode_key(&key));
        assert_eq!(decode_key(&padded).expect("decode"), key);
    }

    #[test]
    fn a_key_of_the_wrong_length_is_rejected() {
        assert!(decode_key(&B64.encode([0u8; 8])).is_err());
        assert!(decode_key(&B64.encode([0u8; KEY_LEN + 1])).is_err());
    }

    #[test]
    fn malformed_base64_is_rejected() {
        assert!(decode_key("this is not base64!!").is_err());
        assert!(decode_key("").is_err());
    }

    /// Exercises the real OS Secret Service backend (this crate's whole
    /// point is that it's NOT a file this app controls), under a distinct,
    /// obviously-disposable service/account name — never the production
    /// `SERVICE`/`ACCOUNT` pair — so it can never collide with or overwrite
    /// a real vault's key. Cleans up after itself either way.
    ///
    /// Ignored by default: it needs a running credential store (Secret
    /// Service, Keychain, Credential Manager), which a headless CI runner
    /// does not have. Run it on a desktop session with
    /// `cargo test -p vault -- --ignored`.
    #[test]
    #[ignore = "requires a real OS credential store; run on a desktop session"]
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
