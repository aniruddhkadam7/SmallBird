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
const SUPABASE_URL: &str = "https://xubbwgrjvvsbfvxcuzav.supabase.co";
const SUPABASE_ANON_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1YmJ3Z3JqdnZzYmZ2eGN1emF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NzQ5NjAsImV4cCI6MjEwMjQ1MDk2MH0.ZBkDqETqfJFcrmx68wQCqE2RsfvDwyy_k7uJvlY3vJo";

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
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
    user: TokenUser,
}

#[derive(Deserialize)]
struct TokenUser {
    email: Option<String>,
}

fn now_unix() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

async fn parse_auth_error(response: reqwest::Response) -> String {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v.get("msg").or_else(|| v.get("error_description")).and_then(|m| m.as_str()).map(str::to_string));
    message.unwrap_or_else(|| format!("Supabase auth returned {status}"))
}

/// Sends a 6-digit one-time code to `email`. `create_user: true` lets a
/// brand-new email address sign up the same way an existing one logs in —
/// there is no separate "sign up" step.
pub async fn request_otp(email: &str) -> Result<(), String> {
    let response = client()
        .post(format!("{SUPABASE_URL}/auth/v1/otp"))
        .header("apikey", SUPABASE_ANON_KEY)
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .json(&serde_json::json!({ "email": email, "create_user": true }))
        .send()
        .await
        .map_err(|e| format!("failed to reach Smallbird's auth service: {e}"))?;

    if !response.status().is_success() {
        return Err(parse_auth_error(response).await);
    }
    Ok(())
}

pub async fn verify_otp(email: &str, code: &str) -> Result<AuthSession, String> {
    let response = client()
        .post(format!("{SUPABASE_URL}/auth/v1/verify"))
        .header("apikey", SUPABASE_ANON_KEY)
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .json(&serde_json::json!({ "email": email, "token": code, "type": "email" }))
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
