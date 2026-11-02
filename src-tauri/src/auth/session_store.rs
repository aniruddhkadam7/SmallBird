//! Persists the Supabase **refresh token** — Windows Credential Manager via
//! the `keyring` crate on Windows, a user-only file on macOS (see below).
//! Only the refresh token is ever persisted; the short-lived access token
//! lives in `AppState` in memory only (see `auth::client::AuthSession`).

#[cfg(windows)]
const SERVICE_NAME: &str = "Smallbird";
#[cfg(windows)]
const ENTRY_NAME: &str = "supabase-refresh-token";
#[cfg(windows)]
const EMAIL_ENTRY_NAME: &str = "supabase-account-email";

#[cfg(windows)]
fn entry(name: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE_NAME, name).map_err(|e| format!("credential store unavailable: {e}"))
}

#[cfg(windows)]
pub fn store_refresh_token(refresh_token: &str, email: &str) -> Result<(), String> {
    entry(ENTRY_NAME)?.set_password(refresh_token).map_err(|e| format!("failed to store session: {e}"))?;
    entry(EMAIL_ENTRY_NAME)?.set_password(email).map_err(|e| format!("failed to store session: {e}"))
}

/// Returns `Ok(None)` (not an error) if no session is stored yet — the
/// normal "logged out" state, not a failure.
#[cfg(windows)]
pub fn load_refresh_token() -> Result<Option<(String, String)>, String> {
    let refresh_token = match entry(ENTRY_NAME)?.get_password() {
        Ok(token) => token,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(format!("failed to read session: {e}")),
    };
    let email = entry(EMAIL_ENTRY_NAME)?.get_password().unwrap_or_default();
    Ok(Some((refresh_token, email)))
}

#[cfg(windows)]
pub fn clear_session() -> Result<(), String> {
    for name in [ENTRY_NAME, EMAIL_ENTRY_NAME] {
        match entry(name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(format!("failed to clear session: {e}")),
        }
    }
    Ok(())
}

// macOS: a 0600 file in the app's data directory rather than the Keychain.
// Keychain items are bound to the code signature of the app that created
// them, and the macOS build is ad-hoc signed — every release has a new
// signature, so after each auto-update the app could no longer read or
// replace its own saved session ("item already exists") and sign-in hung.
// A user-only file gives the same protection the token has on Windows
// (readable by the signed-in user's processes, nobody else's). Revisit once
// the app is signed with a stable Developer ID.

#[cfg(target_os = "macos")]
#[derive(serde::Serialize, serde::Deserialize)]
struct StoredSession {
    refresh_token: String,
    email: String,
}

#[cfg(target_os = "macos")]
fn session_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("credential store unavailable: HOME is not set")?;
    Ok(std::path::PathBuf::from(home)
        .join("Library/Application Support")
        .join(crate::crash_guard::APP_IDENTIFIER)
        .join("session.json"))
}

#[cfg(target_os = "macos")]
pub fn store_refresh_token(refresh_token: &str, email: &str) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;

    let path = session_path()?;
    let dir = path.parent().ok_or("credential store unavailable")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("failed to store session: {e}"))?;
    let json = serde_json::to_vec(&StoredSession { refresh_token: refresh_token.to_string(), email: email.to_string() })
        .map_err(|e| format!("failed to store session: {e}"))?;

    // Write-then-rename so a crash mid-write never leaves a truncated file
    // (which would read as "signed out").
    let tmp = path.with_extension("json.tmp");
    let _ = std::fs::remove_file(&tmp);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&tmp)
        .map_err(|e| format!("failed to store session: {e}"))?;
    file.write_all(&json).and_then(|()| file.sync_all()).map_err(|e| format!("failed to store session: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("failed to store session: {e}"))
}

/// Returns `Ok(None)` (not an error) if no session is stored yet — the
/// normal "logged out" state, not a failure.
#[cfg(target_os = "macos")]
pub fn load_refresh_token() -> Result<Option<(String, String)>, String> {
    let bytes = match std::fs::read(session_path()?) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("failed to read session: {e}")),
    };
    // An unreadable file is treated as signed out rather than an error the
    // user can't do anything about; the next sign-in overwrites it.
    Ok(serde_json::from_slice::<StoredSession>(&bytes).ok().map(|s| (s.refresh_token, s.email)))
}

#[cfg(target_os = "macos")]
pub fn clear_session() -> Result<(), String> {
    match std::fs::remove_file(session_path()?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("failed to clear session: {e}")),
    }
}
