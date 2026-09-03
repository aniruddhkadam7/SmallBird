//! Tauri commands for the login screen (`Account.tsx`).

use tauri::{AppHandle, State};

use super::client::{self, AuthSession};
use super::oauth;
use crate::state::AppState;

#[tauri::command]
pub async fn request_login_otp(email: String) -> Result<(), String> {
    client::request_otp(&email).await
}

#[tauri::command]
pub async fn verify_login_otp(state: State<'_, AppState>, email: String, code: String) -> Result<AuthSessionInfo, String> {
    let session = client::verify_otp(&email, &code).await?;
    let info = AuthSessionInfo::from(&session);
    let mut guard = state.auth_session.lock().map_err(|_| "session lock poisoned".to_string())?;
    *guard = Some(session);
    Ok(info)
}

/// Opens the system browser for Google sign-in and blocks until it
/// completes (see `oauth::login_with_google` for the full mechanism — a
/// local loopback listener catching the PKCE redirect, since a desktop app
/// has no page of its own for Supabase to redirect back to).
#[tauri::command]
pub async fn login_with_google(app: AppHandle, state: State<'_, AppState>) -> Result<AuthSessionInfo, String> {
    let session = oauth::login_with_google(app).await?;
    let info = AuthSessionInfo::from(&session);
    let mut guard = state.auth_session.lock().map_err(|_| "session lock poisoned".to_string())?;
    *guard = Some(session);
    Ok(info)
}

#[tauri::command]
pub fn logout(state: State<'_, AppState>) -> Result<(), String> {
    client::logout()?;
    let mut guard = state.auth_session.lock().map_err(|_| "session lock poisoned".to_string())?;
    *guard = None;
    Ok(())
}

/// What the frontend needs to render login state — never includes the raw
/// access/refresh tokens, which stay server(Rust)-side only.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSessionInfo {
    pub logged_in: bool,
    pub email: Option<String>,
}

impl From<&AuthSession> for AuthSessionInfo {
    fn from(session: &AuthSession) -> Self {
        Self { logged_in: true, email: Some(session.email.clone()) }
    }
}

#[tauri::command]
pub async fn get_auth_session(state: State<'_, AppState>) -> Result<AuthSessionInfo, String> {
    // First call in the app's lifetime: nothing in memory yet, try to
    // restore from the stored refresh token before reporting logged-out.
    let has_session = { state.auth_session.lock().map_err(|_| "session lock poisoned".to_string())?.is_some() };
    if !has_session {
        super::restore_session_on_startup(&state).await;
    }

    let guard = state.auth_session.lock().map_err(|_| "session lock poisoned".to_string())?;
    Ok(match guard.as_ref() {
        Some(session) => AuthSessionInfo::from(session),
        None => AuthSessionInfo { logged_in: false, email: None },
    })
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntitlementInfo {
    pub plan_id: String,
    pub remaining_minutes: f64,
    pub interview_pass_count: u32,
}

/// Reads the signed-in user's own `entitlements` row via Supabase's REST API
/// (PostgREST), scoped by RLS to their own row (see the `entitlements_select_own`
/// policy) — no separate Edge Function needed for a plain read like this.
#[tauri::command]
pub async fn get_entitlement(state: State<'_, AppState>) -> Result<EntitlementInfo, String> {
    let access_token = crate::auth::current_access_token(&state).await?;
    client::get_entitlement(&access_token).await
}
