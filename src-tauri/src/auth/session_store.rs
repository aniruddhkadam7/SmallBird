//! Persists the Supabase **refresh token** in Windows Credential Manager via
//! the `keyring` crate — same pattern as the BYOK-era `personal::api_key_store`
//! /`stt::key_store` this replaces. Only the refresh token is ever persisted;
//! the short-lived access token lives in `AppState` in memory only (see
//! `auth::client::AuthSession`).

const SERVICE_NAME: &str = "Smallbird";
const ENTRY_NAME: &str = "supabase-refresh-token";
const EMAIL_ENTRY_NAME: &str = "supabase-account-email";

fn entry(name: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE_NAME, name).map_err(|e| format!("credential store unavailable: {e}"))
}

pub fn store_refresh_token(refresh_token: &str, email: &str) -> Result<(), String> {
    entry(ENTRY_NAME)?.set_password(refresh_token).map_err(|e| format!("failed to store session: {e}"))?;
    entry(EMAIL_ENTRY_NAME)?.set_password(email).map_err(|e| format!("failed to store session: {e}"))
}

/// Returns `Ok(None)` (not an error) if no session is stored yet — the
/// normal "logged out" state, not a failure.
pub fn load_refresh_token() -> Result<Option<(String, String)>, String> {
    let refresh_token = match entry(ENTRY_NAME)?.get_password() {
        Ok(token) => token,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(format!("failed to read session: {e}")),
    };
    let email = entry(EMAIL_ENTRY_NAME)?.get_password().unwrap_or_default();
    Ok(Some((refresh_token, email)))
}

pub fn clear_session() -> Result<(), String> {
    for name in [ENTRY_NAME, EMAIL_ENTRY_NAME] {
        match entry(name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(format!("failed to clear session: {e}")),
        }
    }
    Ok(())
}
