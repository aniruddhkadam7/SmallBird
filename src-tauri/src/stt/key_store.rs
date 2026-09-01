//! Persists the user's Deepgram API key in Windows Credential Manager via the
//! `keyring` crate — same mechanism and service name as
//! `personal::api_key_store`, just for STT rather than an `LlmProvider` (see
//! that module's doc comment for why Deepgram isn't folded into the
//! `LlmProvider` enum). Never a plaintext file on disk, never logged, never
//! sent anywhere except directly to Deepgram.

const SERVICE_NAME: &str = "Smallbird";
const ENTRY_NAME: &str = "personal-api-key-deepgram";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE_NAME, ENTRY_NAME).map_err(|e| format!("credential store unavailable: {e}"))
}

pub fn store_key(key: &str) -> Result<(), String> {
    entry()?.set_password(key).map_err(|e| format!("failed to store API key: {e}"))
}

/// Returns `Ok(None)` (not an error) if no key is stored yet — the normal
/// "not configured" state, not a failure.
pub fn load_key() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("failed to read API key: {e}")),
    }
}

pub fn clear_key() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("failed to clear API key: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Exercises the real Windows Credential Manager — see
    // `personal::api_key_store`'s identical test for why this is `#[ignore]`d
    // by default.
    #[test]
    #[ignore = "requires a real, accessible Windows Credential Manager — not available in a sandboxed/headless test runner. Run manually with `cargo test -- --ignored` on a real desktop session before release."]
    fn round_trips_through_real_credential_store() {
        let _ = clear_key();

        assert_eq!(load_key().unwrap(), None);

        store_key("test-key-value").unwrap();
        assert_eq!(load_key().unwrap(), Some("test-key-value".to_string()));

        clear_key().unwrap();
        assert_eq!(load_key().unwrap(), None);
    }
}
