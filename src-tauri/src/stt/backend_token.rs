//! Talks to the deployed `stt-token` / `session-heartbeat` / `usage-report`
//! Supabase Edge Functions (see `backend/supabase/functions/`). This is
//! where a Deepgram key now comes from — a short-lived, scoped key minted
//! per session, replacing the user's own permanent key from the removed
//! `stt::key_store`.

use std::time::{Duration, Instant};

use serde::Deserialize;
use tokio::sync::oneshot;

/// TODO(deploy): same project as `auth::client::SUPABASE_URL` — keep these
/// in sync (or factor into one shared constant once both are finalized).
const SUPABASE_URL: &str = "https://xubbwgrjvvsbfvxcuzav.supabase.co";
const REQUEST_TIMEOUT_SECS: u64 = 15;
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(60);

/// Held in `AppState` while a session is active. `deepgram_key` is what
/// `start_capture_inner` (`commands.rs`) passes to `SttClient::spawn`
/// unchanged — only its *source* changed from a stored user key to this
/// per-session minted one.
pub struct SttSession {
    pub session_id: String,
    pub deepgram_key: String,
    pub started_at: Instant,
    pub heartbeat_cancel: Option<oneshot::Sender<()>>,
}

pub struct MintedSession {
    pub session_id: String,
    pub key: String,
}

#[derive(Deserialize)]
struct MintResponse {
    #[serde(rename = "sessionId")]
    session_id: String,
    key: String,
}

#[derive(Deserialize)]
struct ErrorResponse {
    error: String,
}

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

async fn parse_error(response: reqwest::Response) -> String {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    serde_json::from_str::<ErrorResponse>(&text).map(|e| e.error).unwrap_or_else(|_| format!("request failed ({status})"))
}

/// Starts an `interview_sessions` row server-side and returns a scoped
/// Deepgram key. Fails with a user-facing message on: no minutes left
/// (402), an active session already exists elsewhere (409), or any network/
/// auth problem — there is no local fallback anymore, so any failure here
/// means the session cannot start at all.
pub async fn mint(access_token: &str) -> Result<MintedSession, String> {
    let response = client()
        .post(format!("{SUPABASE_URL}/functions/v1/stt-token"))
        .bearer_auth(access_token)
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|e| format!("failed to reach Smallbird's transcription service: {e}"))?;

    if !response.status().is_success() {
        return Err(parse_error(response).await);
    }
    let body: MintResponse = response.json().await.map_err(|e| format!("unexpected response starting transcription: {e}"))?;
    Ok(MintedSession { session_id: body.session_id, key: body.key })
}

async fn heartbeat(access_token: &str, session_id: &str) -> Result<(), String> {
    let response = client()
        .post(format!("{SUPABASE_URL}/functions/v1/session-heartbeat"))
        .bearer_auth(access_token)
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .json(&serde_json::json!({ "sessionId": session_id }))
        .send()
        .await
        .map_err(|e| format!("heartbeat failed: {e}"))?;
    if !response.status().is_success() {
        return Err(parse_error(response).await);
    }
    Ok(())
}

pub async fn report_usage(access_token: &str, session_id: &str, actual_duration_seconds: f64) -> Result<(), String> {
    let response = client()
        .post(format!("{SUPABASE_URL}/functions/v1/usage-report"))
        .bearer_auth(access_token)
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .json(&serde_json::json!({ "sessionId": session_id, "actualDurationSeconds": actual_duration_seconds }))
        .send()
        .await
        .map_err(|e| format!("usage report failed: {e}"))?;
    if !response.status().is_success() {
        return Err(parse_error(response).await);
    }
    Ok(())
}

/// Runs until `cancel` fires at session end. A failed heartbeat is logged
/// and retried on the next tick rather than ending the loop — a transient
/// network blip shouldn't let the backend's stale-session sweep (2 minutes
/// of silence) expire an otherwise-healthy session over one missed beat.
///
/// Known limitation: the access token captured at session start isn't
/// refreshed mid-loop. Fine for a typical session length, but a session
/// longer than the token's lifetime would see heartbeats start failing —
/// acceptable for now, worth revisiting if very long sessions are common.
pub async fn run_heartbeat_loop(access_token: String, session_id: String, mut cancel: oneshot::Receiver<()>) {
    let mut interval = tokio::time::interval(HEARTBEAT_INTERVAL);
    interval.tick().await; // first tick fires immediately; the session just started, nothing to report yet.
    loop {
        tokio::select! {
            _ = &mut cancel => return,
            _ = interval.tick() => {
                if let Err(err) = heartbeat(&access_token, &session_id).await {
                    log::warn!("stt session heartbeat failed: {err}");
                }
            }
        }
    }
}
