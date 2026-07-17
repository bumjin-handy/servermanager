use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng, Payload},
    Aes256Gcm, Key, Nonce,
};
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use keyring::Entry;
use std::sync::{Mutex, OnceLock};

const KEYRING_SERVICE: &str = "servermanager";
const KEYRING_USER: &str = "env-master-key";
const SERVER_SECRET_PREFIX: &str = "server-secret:";
/// Stored form: `ENC:v1:<url-safe-base64(nonce || ciphertext+tag)>` (no `+` `/` `=`).
pub const PREFIX: &str = "ENC:v1:";
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

static MASTER_KEY: OnceLock<[u8; KEY_LEN]> = OnceLock::new();
static MASTER_KEY_INIT: Mutex<()> = Mutex::new(());

/// True when the stored value is app-encrypted (not plaintext).
pub fn is_encrypted(value: &str) -> bool {
    value.trim_start().starts_with(PREFIX)
}

/// Encrypt plaintext (kept for tests / optional future use; `.env` now stores plaintext).
#[allow(dead_code)]
pub fn encrypt_secret(plaintext: &str, aad: &str) -> Result<String> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }
    let key_bytes = load_or_create_master_key()?;
    encrypt_with_key(&key_bytes, plaintext, aad)
}

/// Decrypt a stored value. Legacy plaintext (no `ENC:v1:` prefix) is returned as-is.
/// Also accepts legacy `ENC:v1:` values encoded with standard Base64 (`+`, `/`, `=`).
/// If the value was accidentally double-encrypted, unwrap up to 3 layers.
pub fn decrypt_secret(stored: &str, aad: &str) -> Result<String> {
    let mut current = strip_wrapping_quotes(stored.trim());
    if current.is_empty() {
        return Ok(String::new());
    }

    for _ in 0..3 {
        if !is_encrypted(&current) {
            return Ok(current);
        }
        current = decrypt_one_layer(&current, aad)?;
    }

    if is_encrypted(&current) {
        bail!(
            "자격 증명이 여러 번 암호화되어 있습니다. 서버 수정에서 평문 암호를 다시 저장하세요."
        );
    }
    Ok(current)
}

fn decrypt_one_layer(stored: &str, aad: &str) -> Result<String> {
    let b64 = stored
        .strip_prefix(PREFIX)
        .ok_or_else(|| anyhow::anyhow!("암호화된 자격 증명 형식이 올바르지 않습니다"))?
        .trim();
    let packed = decode_packed(b64).context("암호화된 자격 증명 Base64 디코드 실패")?;
    if packed.len() <= NONCE_LEN {
        bail!("암호화된 자격 증명 데이터가 너무 짧습니다");
    }

    let (nonce_bytes, ciphertext) = packed.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);
    let key_bytes = load_or_create_master_key()?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let plaintext = cipher
        .decrypt(
            nonce,
            Payload {
                msg: ciphertext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| {
            anyhow::anyhow!(
                "자격 증명 복호화에 실패했습니다. 서버를 수정해 암호를 다시 저장해 주세요."
            )
        })?;

    String::from_utf8(plaintext).context("복호화된 자격 증명이 UTF-8이 아닙니다")
}

/// Reject pasting an already-encrypted blob into the password field.
pub fn ensure_plaintext_secret(value: &str) -> Result<()> {
    let v = value.trim();
    if is_encrypted(v) {
        bail!(
            "암호화된 값(ENC:v1:...)이 입력되었습니다. .env 내용이 아니라 실제 SSH 평문 암호를 입력하세요."
        );
    }
    Ok(())
}

/// Store plaintext server secret in OS keyring (source of truth for SSH auth).
pub fn save_server_secret(server_id: &str, secret: &str) -> Result<()> {
    let id = server_id.trim();
    if id.is_empty() {
        bail!("서버 ID가 비어 있습니다");
    }
    ensure_plaintext_secret(secret)?;
    let entry = Entry::new(KEYRING_SERVICE, &format!("{SERVER_SECRET_PREFIX}{id}"))
        .context("서버 시크릿 키링 항목 생성 실패")?;
    entry
        .set_password(secret)
        .context("서버 시크릿을 OS 키링에 저장하지 못했습니다")?;
    Ok(())
}

/// Load plaintext server secret from OS keyring.
pub fn load_server_secret(server_id: &str) -> Result<Option<String>> {
    let id = server_id.trim();
    if id.is_empty() {
        return Ok(None);
    }
    let entry = Entry::new(KEYRING_SERVICE, &format!("{SERVER_SECRET_PREFIX}{id}"))
        .context("서버 시크릿 키링 항목 생성 실패")?;
    match entry.get_password() {
        Ok(v) if !v.is_empty() => Ok(Some(v)),
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e).context("서버 시크릿을 OS 키링에서 읽지 못했습니다"),
    }
}

pub fn delete_server_secret(server_id: &str) -> Result<()> {
    let id = server_id.trim();
    if id.is_empty() {
        return Ok(());
    }
    let entry = Entry::new(KEYRING_SERVICE, &format!("{SERVER_SECRET_PREFIX}{id}"))
        .context("서버 시크릿 키링 항목 생성 실패")?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e).context("서버 시크릿 키링 삭제 실패"),
    }
}

#[allow(dead_code)]
fn encrypt_with_key(key_bytes: &[u8; KEY_LEN], plaintext: &str, aad: &str) -> Result<String> {
    let key = Key::<Aes256Gcm>::from_slice(key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext.as_bytes(),
                aad: aad.as_bytes(),
            },
        )
        .map_err(|e| anyhow::anyhow!("자격 증명 암호화 실패: {e}"))?;

    let mut packed = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    packed.extend_from_slice(nonce.as_slice());
    packed.extend_from_slice(&ciphertext);
    Ok(format!("{PREFIX}{}", B64.encode(packed)))
}

fn decode_packed(b64: &str) -> Result<Vec<u8>> {
    if let Ok(v) = B64.decode(b64) {
        return Ok(v);
    }
    // Legacy values written with standard Base64 before the URL-safe switch.
    base64::engine::general_purpose::STANDARD
        .decode(b64)
        .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(b64))
        .context("Base64 디코드 실패")
}

fn strip_wrapping_quotes(s: &str) -> String {
    let s = s.trim();
    if s.len() >= 2 {
        let b = s.as_bytes();
        if (b[0] == b'"' && b[s.len() - 1] == b'"') || (b[0] == b'\'' && b[s.len() - 1] == b'\'') {
            return s[1..s.len() - 1].to_string();
        }
    }
    s.to_string()
}

fn load_or_create_master_key() -> Result<[u8; KEY_LEN]> {
    if let Some(k) = MASTER_KEY.get() {
        return Ok(*k);
    }
    let _guard = MASTER_KEY_INIT
        .lock()
        .map_err(|_| anyhow::anyhow!("마스터 키 초기화 잠금 실패"))?;
    if let Some(k) = MASTER_KEY.get() {
        return Ok(*k);
    }

    let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER).context("키링 항목 생성 실패")?;
    let key = match entry.get_password() {
        Ok(stored) => {
            let bytes = decode_master_key_bytes(&stored)?;
            let mut key = [0u8; KEY_LEN];
            key.copy_from_slice(&bytes);
            key
        }
        Err(keyring::Error::NoEntry) => {
            let generated = Aes256Gcm::generate_key(&mut OsRng);
            let encoded = B64.encode(generated.as_slice());
            entry
                .set_password(&encoded)
                .context("마스터 키를 OS 키링에 저장하지 못했습니다")?;
            let mut key = [0u8; KEY_LEN];
            key.copy_from_slice(generated.as_slice());
            key
        }
        Err(e) => return Err(e).context("마스터 키를 OS 키링에서 읽지 못했습니다"),
    };

    let _ = MASTER_KEY.set(key);
    Ok(key)
}

fn decode_master_key_bytes(stored: &str) -> Result<Vec<u8>> {
    let stored = stored.trim();
    let bytes = B64.decode(stored).or_else(|_| {
        base64::engine::general_purpose::STANDARD
            .decode(stored)
            .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(stored))
    })?;
    if bytes.len() != KEY_LEN {
        bail!("마스터 키 길이가 올바르지 않습니다 ({} bytes)", bytes.len());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = Aes256Gcm::generate_key(&mut OsRng);
        let mut key_bytes = [0u8; KEY_LEN];
        key_bytes.copy_from_slice(key.as_slice());
        let enc = encrypt_with_key(&key_bytes, "p@ss w0rd!", "SSH_PASSWORD").unwrap();
        assert!(enc.starts_with(PREFIX));
        assert!(!enc.contains('+'));
        assert!(!enc.contains('/'));
        assert!(!enc.contains('='));

        // decrypt_secret needs master key from keyring — test encrypt_with_key path via manual decrypt:
        let b64 = enc.strip_prefix(PREFIX).unwrap();
        let packed = B64.decode(b64).unwrap();
        let (nonce_bytes, ciphertext) = packed.split_at(NONCE_LEN);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
        let pt = cipher
            .decrypt(
                Nonce::from_slice(nonce_bytes),
                Payload {
                    msg: ciphertext,
                    aad: b"SSH_PASSWORD",
                },
            )
            .unwrap();
        assert_eq!(String::from_utf8(pt).unwrap(), "p@ss w0rd!");
    }

    #[test]
    fn strip_quotes_works() {
        assert_eq!(strip_wrapping_quotes("'ENC:v1:abc'"), "ENC:v1:abc");
        assert_eq!(strip_wrapping_quotes("\"ENC:v1:abc\""), "ENC:v1:abc");
    }
}
