//! Thin wrapper over Supabase's Auth REST API — passwordless email-OTP login,
//! matching the website's signup flow so the same account works on both
//! surfaces. Reuses the app's existing `reqwest` dependency and rustls setup
//! (`tls_init::ensure_installed`, already called once at startup in `lib.rs`).

use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::session_store;

/// TODO(deploy): fill in the real values before building. Both are public,
/// client-safe identifiers (not secrets) — the same ones the website uses as
/// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. Find them in the
/// Supabase dashboard: Project Settings -> API.
pub(crate) const SUPABASE_URL: &str = "https://xubbwgrjvvsbfvxcuzav.supabase.co";
pub(crate) const SUPABASE_ANON_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1YmJ3Z3JqdnZzYmZ2eGN1emF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NzQ5NjAsImV4cCI6MjEwMjQ1MDk2MH0.ZBkDqETqfJFcrmx68wQCqE2RsfvDwyy_k7uJvlY3vJo";

const REQUEST_TIMEOUT_SECS: u64 = 15;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSession {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix timestamp (seconds) after which `access_token` should be
    /// refreshed before use.
    pub expires_at: i64,
    pub email: String,
}

#[derive(Deserialize)]
pub(super) struct TokenResponse {
    pub(super) access_token: String,
    pub(super) refresh_token: String,
    pub(super) expires_in: i64,
    pub(super) user: TokenUser,
}

#[derive(Deserialize)]
pub(super) struct TokenUser {
    pub(super) email: Option<String>,
}

pub(super) fn now_unix() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

pub(super) fn client() -> reqwest::Client {
    reqwest::Client::new()
}

/// Value of the `x-smallbird-client` header, e.g. `desktop/0.1.35 (windows)`,
/// so the backend can record which app version and OS a user signs in and
/// runs interviews from (see backend/supabase/functions/_shared/device.ts).
pub(crate) fn client_header() -> String {
    format!("desktop/{} ({})", env!("CARGO_PKG_VERSION"), std::env::consts::OS)
}

pub(super) async fn parse_auth_error(response: reqwest::Response) -> String {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| {
            v.get("msg")
                .or_else(|| v.get("error_description"))
                .or_else(|| v.get("error"))
                .and_then(|m| m.as_str())
                .map(str::to_string)
        });
    message.unwrap_or_else(|| format!("Supabase auth returned {status}"))
}

/// Sends a 4-digit one-time code to `email` via the `request-otp` Edge
/// Function (backend/supabase/functions/request-otp). Supabase's built-in
/// `/auth/v1/otp` is fixed at 6+ digits with no length setting, so this
/// replaces it. A brand-new email address signs up the same way an
/// existing one logs in — there is no separate "sign up" step.
pub async fn request_otp(email: &str) -> Result<(), String> {
    let response = client()
        .post(format!("{SUPABASE_URL}/functions/v1/request-otp"))
        .header("apikey", SUPABASE_ANON_KEY)
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .json(&serde_json::json!({ "email": email }))
        .send()
        .await
        .map_err(|e| format!("failed to reach Smallbird's auth service: {e}"))?;

    if !response.status().is_success() {
        return Err(parse_auth_error(response).await);
    }
    Ok(())
}

/// Verifies the 4-digit code via the `verify-otp` Edge Function
/// (backend/supabase/functions/verify-otp), which mints a real Supabase
/// session server-side once the code checks out.
pub async fn verify_otp(email: &str, code: &str, name: Option<&str>) -> Result<AuthSession, String> {
    let response = client()
        .post(format!("{SUPABASE_URL}/functions/v1/verify-otp"))
        .header("apikey", SUPABASE_ANON_KEY)
        .header("x-smallbird-client", client_header())
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .json(&serde_json::json!({ "email": email, "code": code, "name": name }))
        .send()
        .await
        .map_err(|e| format!("failed to reach Smallbird's auth service: {e}"))?;

    if !response.status().is_success() {
        return Err(parse_auth_error(response).await);
    }

    let body: TokenResponse = response.json().await.map_err(|e| format!("unexpected response from auth service: {e}"))?;
    let session = AuthSession {
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        expires_at: now_unix() + body.expires_in,
        email: body.user.email.unwrap_or_else(|| email.to_string()),
    };
    session_store::store_refresh_token(&session.refresh_token, &session.email)?;
    Ok(session)
}

pub async fn refresh_session(refresh_token: &str, email: &str) -> Result<AuthSession, String> {
    let response = client()
        .post(format!("{SUPABASE_URL}/auth/v1/token?grant_type=refresh_token"))
        .header("apikey", SUPABASE_ANON_KEY)
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .json(&serde_json::json!({ "refresh_token": refresh_token }))
        .send()
        .await
        .map_err(|e| format!("failed to reach Smallbird's auth service: {e}"))?;

    if !response.status().is_success() {
        // A rejected refresh token means the session is no longer valid —
        // clear it so the app doesn't keep retrying a dead credential.
        let _ = session_store::clear_session();
        return Err(parse_auth_error(response).await);
    }

    let body: TokenResponse = response.json().await.map_err(|e| format!("unexpected response from auth service: {e}"))?;
    let session = AuthSession {
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        expires_at: now_unix() + body.expires_in,
        email: body.user.email.unwrap_or_else(|| email.to_string()),
    };
    session_store::store_refresh_token(&session.refresh_token, &session.email)?;
    Ok(session)
}

pub fn logout() -> Result<(), String> {
    session_store::clear_session()
}

/// A session is treated as needing refresh 60s before it actually expires,
/// so a call in flight doesn't race the expiry.
pub fn needs_refresh(session: &AuthSession) -> bool {
    now_unix() >= session.expires_at - 60
}

#[derive(Deserialize)]
struct EntitlementRow {
    plan_id: String,
    remaining_minutes: f64,
}

/// Reads the caller's own `entitlements` row via PostgREST, scoped by RLS to
/// their own `user_id` — same account whether called from the login screen
/// or the Interview overlay's live minutes display.
pub async fn get_entitlement(access_token: &str) -> Result<super::commands::EntitlementInfo, String> {
    let response = client()
        .get(format!("{SUPABASE_URL}/rest/v1/entitlements?select=plan_id,remaining_minutes"))
        .header("apikey", SUPABASE_ANON_KEY)
        .bearer_auth(access_token)
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| format!("failed to reach Smallbird's account service: {e}"))?;

    if !response.status().is_success() {
        return Err(parse_auth_error(response).await);
    }

    let rows: Vec<EntitlementRow> = response.json().await.map_err(|e| format!("unexpected response reading your plan: {e}"))?;
    let row = rows.into_iter().next().ok_or_else(|| "No plan found for this account".to_string())?;

    let interview_pass_count = count_interview_pass_purchases(access_token).await.unwrap_or(0);

    Ok(super::commands::EntitlementInfo {
        plan_id: row.plan_id,
        remaining_minutes: row.remaining_minutes,
        interview_pass_count,
    })
}

/// Best-effort: a failure here shouldn't block the rest of the Account panel
/// from rendering, so callers fall back to 0 rather than propagating an
/// error (see `.unwrap_or(0)` above).
async fn count_interview_pass_purchases(access_token: &str) -> Result<u32, String> {
    let response = client()
        .get(format!("{SUPABASE_URL}/rest/v1/purchases?select=id&plan_id=eq.interview-pass"))
        .header("apikey", SUPABASE_ANON_KEY)
        .bearer_auth(access_token)
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("purchases lookup returned {}", response.status()));
    }
    let rows: Vec<serde_json::Value> = response.json().await.map_err(|e| e.to_string())?;
    Ok(rows.len() as u32)
}
