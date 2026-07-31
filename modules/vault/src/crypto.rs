//! Pure crypto primitives for the vault, kept isolated from SQLite/protocol
//! code and unit tested on their own.
//!
//! Design (v2 — revised from the first pass after clarifying the actual
//! threat model): the AES-256-GCM encryption key is pure random data,
//! generated once by this code via the OS CSPRNG, never derived from
//! anything the user types. It is stored in the OS's own secure credential
//! store (see os_keychain.rs — Secret Service on Linux, Keychain on macOS,
//! Credential Manager on Windows), physically separate from vault.db. The
//! point: copying vault.db off the disk gets an attacker ciphertext and
//! nothing else — the key isn't in that file, or derivable from it, at all.
//!
//! The user-facing gate is a 6-digit PIN, checked against an Argon2id hash
//! stored in vault.db. The PIN is NOT the encryption key and doesn't derive
//! it — a 6-digit code (1M combinations) isn't trying to be
//! cryptographically strong on its own. It's a fast local "is this really
//! you" check layered in front of retrieving the real key from OS storage,
//! same relationship a phone's lock-screen PIN has to its actual disk
//! encryption key. Because the PIN's job is that much narrower, changing it
//! no longer requires touching any encrypted entry (see store.rs's
//! `change_pin` vs. the old `change_master_password`, which had to decrypt
//! and re-encrypt everything).
//!
//! (For context: an earlier version of this file derived the encryption key
//! from a user-chosen master password via Argon2id + HKDF-separated
//! subkeys. That was a real improvement over the legacy Python vault it was
//! replacing — which stored a verification hash that WAS the encryption
//! key — but the design was changed again to this one: a password a human
//! can remember is still, structurally, "the user creating the key," which
//! is exactly what this revision moves away from.)

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::rngs::OsRng;
use rand::{Rng, RngCore};

pub const SALT_LEN: usize = 16;
pub const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

#[derive(Clone, Copy)]
pub struct KdfParams {
    pub m_cost_kib: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

impl Default for KdfParams {
    /// Params for hashing the 6-digit PIN. Deliberately much lighter than
    /// a master-password KDF would need — a 6-digit code has at most 1e6
    /// possibilities, so no amount of Argon2id cost makes offline brute
    /// force of the hash alone infeasible. What actually stops guessing is
    /// the lockout in store.rs and the fact the real key isn't derivable
    /// from the PIN or its hash at all; this cost just avoids the hash
    /// being instant to compute in a tight loop.
    fn default() -> Self {
        KdfParams { m_cost_kib: 19456, t_cost: 2, p_cost: 1 }
    }
}

pub fn random_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    salt
}

/// The actual AES-256-GCM key — pure random, generated once at vault
/// creation, then stored in the OS keychain and never touched again except
/// to read it back on unlock.
pub fn generate_key() -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);
    key
}

pub fn hash_pin(pin: &str, salt: &[u8], params: &KdfParams) -> Result<[u8; 32], String> {
    let argon2_params = Params::new(params.m_cost_kib, params.t_cost, params.p_cost, Some(32)).map_err(|e| e.to_string())?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon2_params);
    let mut out = [0u8; 32];
    argon2.hash_password_into(pin.as_bytes(), salt, &mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

pub fn encrypt(key: &[u8; KEY_LEN], plaintext: &[u8]) -> Vec<u8> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher.encrypt(nonce, plaintext).expect("AES-256-GCM encryption cannot fail for valid key/nonce lengths");

    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    out
}

pub fn decrypt(key: &[u8; KEY_LEN], blob: &[u8]) -> Result<Vec<u8>, String> {
    if blob.len() < NONCE_LEN {
        return Err("zaszyfrowane dane są uszkodzone (za krótkie)".into());
    }
    let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher.decrypt(nonce, ciphertext).map_err(|_| "nie udało się odszyfrować (błędny klucz lub uszkodzone dane)".to_string())
}

pub struct GeneratorOptions {
    pub length: usize,
    pub upper: bool,
    pub lower: bool,
    pub digits: bool,
    pub symbols: bool,
}

/// Uniform random selection from the combined charset via OsRng —
/// `gen_range` does rejection sampling under the hood, so this isn't
/// biased toward the front of the alphabet the way plain `rand() % len`
/// would be.
pub fn generate_password(opts: &GeneratorOptions) -> Result<String, String> {
    const UPPER: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const LOWER: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
    const DIGITS: &[u8] = b"0123456789";
    const SYMBOLS: &[u8] = b"!@#$%^&*()-_=+[]{};:,.?";

    let mut charset = Vec::new();
    if opts.upper {
        charset.extend_from_slice(UPPER);
    }
    if opts.lower {
        charset.extend_from_slice(LOWER);
    }
    if opts.digits {
        charset.extend_from_slice(DIGITS);
    }
    if opts.symbols {
        charset.extend_from_slice(SYMBOLS);
    }
    if charset.is_empty() {
        return Err("wybierz przynajmniej jeden zestaw znaków".into());
    }
    if opts.length == 0 || opts.length > 256 {
        return Err("długość hasła musi być między 1 a 256".into());
    }

    let mut rng = OsRng;
    let password: String = (0..opts.length).map(|_| charset[rng.gen_range(0..charset.len())] as char).collect();
    Ok(password)
}

/// Simple heuristic strength score (0-4, same scale as zxcvbn's, but a much
/// lighter length+character-class-diversity estimate rather than zxcvbn's
/// full dictionary/pattern analysis). Documented as approximate — good
/// enough to flag obviously weak entries, not a replacement for a real
/// crack-time estimator.
pub fn estimate_strength(password: &str) -> u8 {
    if password.is_empty() {
        return 0;
    }
    let len = password.chars().count();
    let has_upper = password.chars().any(|c| c.is_uppercase());
    let has_lower = password.chars().any(|c| c.is_lowercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    let has_symbol = password.chars().any(|c| !c.is_alphanumeric());
    let class_count = [has_upper, has_lower, has_digit, has_symbol].iter().filter(|b| **b).count();

    let score = match (len, class_count) {
        (l, _) if l < 8 => 0,
        (l, c) if l < 10 && c < 3 => 1,
        (l, c) if l < 12 && c < 3 => 2,
        (l, c) if l >= 16 && c >= 3 => 4,
        (l, c) if l >= 12 && c >= 2 => 3,
        _ => 1,
    };
    score.min(4)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = [7u8; KEY_LEN];
        let plaintext = b"tajne dane wpisu";
        let blob = encrypt(&key, plaintext);
        let decrypted = decrypt(&key, &blob).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn decrypt_fails_with_wrong_key() {
        let key_a = [1u8; KEY_LEN];
        let key_b = [2u8; KEY_LEN];
        let blob = encrypt(&key_a, b"secret");
        assert!(decrypt(&key_b, &blob).is_err());
    }

    #[test]
    fn decrypt_fails_on_tampered_ciphertext() {
        let key = [3u8; KEY_LEN];
        let mut blob = encrypt(&key, b"secret payload");
        let last = blob.len() - 1;
        blob[last] ^= 0xFF;
        assert!(decrypt(&key, &blob).is_err());
    }

    #[test]
    fn same_plaintext_encrypts_differently_each_time() {
        let key = [9u8; KEY_LEN];
        let a = encrypt(&key, b"same input");
        let b = encrypt(&key, b"same input");
        assert_ne!(a, b, "nonce must be fresh per call");
    }

    #[test]
    fn generated_keys_are_random_and_full_length() {
        let a = generate_key();
        let b = generate_key();
        assert_ne!(a, b);
        assert_eq!(a.len(), KEY_LEN);
    }

    #[test]
    fn pin_hash_is_deterministic_for_same_pin_and_salt() {
        let params = KdfParams { m_cost_kib: 8192, t_cost: 1, p_cost: 1 };
        let salt = [5u8; SALT_LEN];
        let a = hash_pin("123456", &salt, &params).unwrap();
        let b = hash_pin("123456", &salt, &params).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn pin_hash_differs_for_different_pins() {
        let params = KdfParams { m_cost_kib: 8192, t_cost: 1, p_cost: 1 };
        let salt = [5u8; SALT_LEN];
        let a = hash_pin("111111", &salt, &params).unwrap();
        let b = hash_pin("222222", &salt, &params).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn generated_password_has_requested_length_and_charset() {
        let opts = GeneratorOptions { length: 24, upper: true, lower: true, digits: true, symbols: false };
        let pw = generate_password(&opts).unwrap();
        assert_eq!(pw.chars().count(), 24);
        assert!(pw.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn generate_password_rejects_empty_charset() {
        let opts = GeneratorOptions { length: 10, upper: false, lower: false, digits: false, symbols: false };
        assert!(generate_password(&opts).is_err());
    }

    #[test]
    fn strength_scores_are_ordered_sensibly() {
        assert_eq!(estimate_strength(""), 0);
        assert!(estimate_strength("short1") <= estimate_strength("LongerPassword123"));
        assert!(estimate_strength("LongerPassword123") <= estimate_strength("Tr0ub4dor&3xtraLong!"));
    }
}
