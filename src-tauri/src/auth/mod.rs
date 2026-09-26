//! Supabase authentication: this build requires login for every AI feature
//! (no BYOK fallback — see `personal::client::DirectLlmClient` and
//! `stt::client::SttClient`, both of which call `current_access_token` below
//! instead of loading a locally-stored provider/Deepgram key).

pub mod client;
pub mod commands;
pub mod oauth;
pub mod session_store;

pub use client::AuthSession;

use crate::state::AppState;
use crate::crash_guard::LockExt;

/// Held while restoring or refreshing the session. Supabase refresh tokens
/// are single-use: two refreshes racing with the same token (e.g. the main
/// window's startup check and a background call at launch) left one of
/// them "not logged in", which made a shortcut pressed right after launch
/// open the login panel for a user who was signed in.
static REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Returns a valid access token for the signed-in user, refreshing it first
/// if it's near expiry. `Err` means "not logged in" or "session expired and
/// couldn't be refreshed" — callers surface this as a normal error, the
/// frontend is expected to have already gated the UI behind login so this
/// should be rare in practice (e.g. the refresh token itself expired after
/// long-term inactivity).
pub async fn current_access_token(state: &tauri::State<'_, AppState>) -> Result<String, String> {
    let existing = {
        let guard = state.auth_session.lock_safe();
        guard.clone()
    };

    let Some(session) = existing else {
        return Err("Not logged in. Please log in from the Account panel.".to_string());
    };

    if !client::needs_refresh(&session) {
        return Ok(session.access_token);
    }

    // One refresh at a time; whoever waited uses the one that just happened.
    let _turn = REFRESH_LOCK.lock().await;
    let session = {
        let guard = state.auth_session.lock_safe();
        guard.clone()
    }
    .ok_or_else(|| "Not logged in. Please log in from the Account panel.".to_string())?;
    if !client::needs_refresh(&session) {
        return Ok(session.access_token);
    }

    let refreshed = client::refresh_session(&session.refresh_token, &session.email).await?;
    let access_token = refreshed.access_token.clone();
    {
        let mut guard = state.auth_session.lock_safe();
        *guard = Some(refreshed);
    }
    Ok(access_token)
}

/// Attempts to restore a session from the stored refresh token — called once
/// at startup. Silently leaves `state.auth_session` as `None` on any failure
/// (expired/revoked refresh token, offline at startup, etc.) rather than
/// treating it as fatal; `get_auth_session` reports the resulting logged-out
/// state to the frontend the same way a fresh install would look.
pub async fn restore_session_on_startup(state: &tauri::State<'_, AppState>) {
    let _turn = REFRESH_LOCK.lock().await;
    // Another caller may have restored it while this one waited its turn.
    if state.auth_session.lock_safe().is_some() {
        return;
    }
    let Ok(Some((refresh_token, email))) = session_store::load_refresh_token() else {
        return;
    };
    // One retry: right after Windows starts (Smallbird launches with it) the
    // network is often not up yet for the first attempt.
    for attempt in 0..2 {
        match client::refresh_session(&refresh_token, &email).await {
            Ok(session) => {
                *state.auth_session.lock_safe() = Some(session);
                return;
            }
            Err(err) => {
                log::warn!("restoring the saved sign-in failed (attempt {}): {err}", attempt + 1);
                if attempt == 0 {
                    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                }
            }
        }
    }
}
