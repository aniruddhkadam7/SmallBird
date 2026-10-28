//! Talks to the deployed `stt-token` / `session-heartbeat` / `usage-report`
//! Supabase Edge Functions (see `backend/supabase/functions/`). This is
//! where a Deepgram key now comes from — a short-lived, scoped key minted
//! per session, replacing the user's own permanent key from the removed
//! `stt::key_store`.

use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Emitter};
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

/// `code` distinguishes "you have an active session elsewhere" (a real,
/// resolvable choice the frontend should offer to act on — see `force`
/// below) from every other failure, which just gets shown as an error.
pub struct MintError {
    pub message: String,
    pub code: Option<String>,
}

impl MintError {
    pub fn is_active_elsewhere(&self) -> bool {
        self.code.as_deref() == Some("ACTIVE_SESSION_ELSEWHERE")
    }
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
    code: Option<String>,
}

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

async fn parse_error(response: reqwest::Response) -> MintError {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    match serde_json::from_str::<ErrorResponse>(&text) {
        Ok(body) => MintError { message: body.error, code: body.code },
        Err(_) => MintError { message: format!("request failed ({status})"), code: None },
    }
}

/// Starts an `interview_sessions` row server-side and returns a scoped
/// Deepgram key. Fails with a user-facing message on: no minutes left
/// (402), an active session already exists elsewhere (409 — set `force` to
/// end that session and take its place instead of failing), or any network/
/// auth problem — there is no local fallback anymore, so any failure here
/// means the session cannot start at all.
pub async fn mint(access_token: &str, force: bool) -> Result<MintedSession, MintError> {
    let response = client()
        .post(format!("{SUPABASE_URL}/functions/v1/stt-token"))
        .bearer_auth(access_token)
        .header("x-smallbird-client", crate::auth::client::client_header())
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .json(&serde_json::json!({ "force": force }))
        .send()
        .await
        .map_err(|e| MintError { message: format!("failed to reach Smallbird's transcription service: {e}"), code: None })?;

    if !response.status().is_success() {
        return Err(parse_error(response).await);
    }
    let body: MintResponse = response
        .json()
        .await
        .map_err(|e| MintError { message: format!("unexpected response starting transcription: {e}"), code: None })?;
    Ok(MintedSession { session_id: body.session_id, key: body.key })
}

enum HeartbeatOutcome {
    Ok,
    /// The session ended (force-ended by a new login elsewhere, or expired)
    /// — no point in retrying, the loop should stop.
    Ended(String),
    /// A network blip or similar — retried on the next tick.
    Transient(String),
}

async fn heartbeat(access_token: &str, session_id: &str) -> HeartbeatOutcome {
    let response = match client()
        .post(format!("{SUPABASE_URL}/functions/v1/session-heartbeat"))
        .bearer_auth(access_token)
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .json(&serde_json::json!({ "sessionId": session_id }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return HeartbeatOutcome::Transient(format!("heartbeat failed: {e}")),
    };

    if response.status().as_u16() == 410 {
        let err = parse_error(response).await;
        return HeartbeatOutcome::Ended(err.message);
    }
    if !response.status().is_success() {
        let err = parse_error(response).await;
        return HeartbeatOutcome::Transient(err.message);
    }
    HeartbeatOutcome::Ok
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
        return Err(parse_error(response).await.message);
    }
    Ok(())
}

/// Runs until `cancel` fires at session end, or until the backend confirms
/// this session has ended some other way (force-ended by a new login on
/// another device — see `mint`'s `force` option — or expired). In the
/// latter case, emits `"stt:session-ended-elsewhere"` so the frontend can
/// stop the recording UI and explain why, instead of it just going quiet.
///
/// A transient failure (network blip) is logged and retried on the next
/// tick rather than ending the loop — the backend's 2-minute stale-session
/// sweep is the real backstop for a truly dead connection, not one missed
/// beat.
///
/// Known limitation: the access token captured at session start isn't
/// refreshed mid-loop. Fine for a typical session length, but a session
/// longer than the token's lifetime would see heartbeats start failing —
/// acceptable for now, worth revisiting if very long sessions are common.
pub async fn run_heartbeat_loop(app: AppHandle, access_token: String, session_id: String, mut cancel: oneshot::Receiver<()>) {
    let mut interval = tokio::time::interval(HEARTBEAT_INTERVAL);
    interval.tick().await; // first tick fires immediately; the session just started, nothing to report yet.
    loop {
        tokio::select! {
            _ = &mut cancel => return,
            _ = interval.tick() => {
                match heartbeat(&access_token, &session_id).await {
                    HeartbeatOutcome::Ok => {}
                    HeartbeatOutcome::Transient(err) => log::warn!("stt session heartbeat failed: {err}"),
                    HeartbeatOutcome::Ended(message) => {
                        let _ = app.emit("stt:session-ended-elsewhere", message);
                        return;
                    }
                }
            }
        }
    }
}
