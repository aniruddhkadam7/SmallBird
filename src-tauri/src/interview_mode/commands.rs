//! Tauri commands for Interview Mode: overlay window lifecycle + the
//! ASK AI flow (uploaded CV/job-description full text -> LLM -> streamed
//! answer).

use tauri::{AppHandle, Emitter, State};

use crate::backend::{AskRequest, ConversationTurn};
use crate::rag::RagClient;
use crate::state::AppState;

use super::window::{self, OverlayCaptureStatus};

/// Answer-shaping options chosen in the overlay's settings panel. Everything
/// is optional: `Default` reproduces the plain "natural, default length"
/// behavior, so a caller that supplies nothing still gets a good answer.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskOptions {
    #[serde(default = "default_answer_length")]
    pub answer_length: String,
    #[serde(default = "default_response_style")]
    pub response_style: String,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub job_description: Option<String>,
    #[serde(default)]
    pub additional_context: Option<String>,
    #[serde(default = "default_english_level")]
    pub english_level: String,
    #[serde(default = "default_humanization")]
    pub humanization: String,
    /// "openai" | "anthropic" | "gemini" — the header dropdown's chosen model provider.
    /// `None` keeps the server-configured default.
    #[serde(default)]
    pub llm_provider: Option<String>,
}

fn default_answer_length() -> String {
    "default".to_string()
}

fn default_response_style() -> String {
    "natural".to_string()
}

fn default_english_level() -> String {
    "simple".to_string()
}

fn default_humanization() -> String {
    "natural".to_string()
}

/// One prior exchange in this Interview Mode session, as sent by the overlay.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct PriorTurn {
    pub question: String,
    pub answer: String,
}

/// How many prior turns to forward. The overlay keeps the whole conversation
/// on screen, but only the recent tail is worth paying for in the prompt:
/// every turn adds tokens to time-to-first-token, which is the number the user
/// feels mid-interview. Six turns comfortably covers "why did you choose
/// that?" style follow-ups, which almost always refer to the last exchange or
/// two.
const MAX_HISTORY_TURNS: usize = 6;

impl Default for AskOptions {
    fn default() -> Self {
        Self {
            answer_length: default_answer_length(),
            response_style: default_response_style(),
            role: None,
            job_description: None,
            additional_context: None,
            english_level: default_english_level(),
            humanization: default_humanization(),
            llm_provider: None,
        }
    }
}

// Window creation/show/hide on Windows must happen on the same OS thread that
// owns the window message loop (the main thread). Tauri dispatches
// non-async `#[tauri::command]`s onto its blocking thread pool, NOT the main
// thread, so calling WebviewWindowBuilder::build()/show()/hide() directly
// from here deadlocks: the worker thread blocks waiting for the main-thread
// window/message APIs, while the main thread is itself waiting on IPC. Route
// the actual window work through `run_on_main_thread` and use a channel to
// bring the result back to the (async) command so the IPC call still
// completes normally instead of hanging forever.
#[tauri::command]
pub async fn show_interview_overlay(app: AppHandle) -> Result<OverlayCaptureStatus, String> {
    run_on_main(&app, window::show_overlay_window).await
}

#[tauri::command]
pub async fn hide_interview_overlay(app: AppHandle) -> Result<(), String> {
    run_on_main(&app, window::close_overlay_window).await
}

#[tauri::command]
pub async fn toggle_interview_overlay(app: AppHandle) -> Result<OverlayCaptureStatus, String> {
    run_on_main(&app, window::toggle_overlay_window).await
}

/// Applied immediately when the user flips "Always on top" in the overlay's
/// Settings panel — see `overlaySettings.ts`/`OverlaySettingsPanel.tsx`.
#[tauri::command]
pub async fn set_overlay_always_on_top(app: AppHandle, enabled: bool) -> Result<(), String> {
    run_on_main(&app, move |app| window::set_overlay_always_on_top(app, enabled)).await
}

/// Applied when the user changes "Overlay size" in Settings. `fraction` is
/// the side length as a fraction of the primary monitor's shorter dimension
/// (small=0.45, medium=0.6, large=0.75 — chosen client-side).
#[tauri::command]
pub async fn resize_interview_overlay(app: AppHandle, fraction: f64) -> Result<(), String> {
    run_on_main(&app, move |app| window::resize_overlay(app, fraction)).await
}

async fn run_on_main<T, F>(app: &AppHandle, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&AppHandle) -> Result<T, String> + Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel();
    let app_for_main = app.clone();
    app.run_on_main_thread(move || {
        let result = f(&app_for_main);
        let _ = tx.send(result);
    })
    .map_err(|e| format!("failed to schedule work on main thread: {e}"))?;

    tauri::async_runtime::spawn_blocking(move || {
        rx.recv()
            .map_err(|e| format!("main-thread task did not respond: {e}"))?
    })
    .await
    .map_err(|e| format!("main-thread task panicked: {e}"))?
}

/// Fetches the full extracted text of the most recently uploaded document of
/// `document_type` (RESUME, JOB_DESCRIPTION, or ADDITIONAL_CONTEXT). These are
/// short enough to just read in full — sent directly to the LLM as context.
/// Returns `None` on any failure (extraction service unavailable, no
/// matching document, still extracting) — this must never fail the ask
/// itself, only mean the answer proceeds without that document.
///
/// `service_available` short-circuits before touching the network at all
/// when the extraction service is known not to be running (see
/// `AppState.rag_service`) — a connect attempt to a port nothing is
/// listening on doesn't fail instantly on Windows (observed: it sits in
/// `SYN_SENT` until the request's own timeout elapses), so without this
/// check every single question would pay a multi-second real-network delay
/// for a call that could never succeed.
async fn fetch_document_full_text(document_type: &str, service_available: bool) -> Option<String> {
    if !service_available {
        return None;
    }
    let client = RagClient::new();
    let documents = client.list_documents(None).await.ok()?;
    let latest = documents
        .into_iter()
        .filter(|d| d.document_type == document_type && d.status == "READY")
        .max_by(|a, b| a.updated_at.total_cmp(&b.updated_at))?;
    client.get_document_text(&latest.document_id).await.ok().flatten()
}

/// Runs the ASK AI flow for a single question: question -> ONE LLM call ->
/// stream.
///
/// The uploaded CV, job description, and additional context, if any, are
/// fetched as full text (see `fetch_document_full_text`) and sent on every
/// question. The three fetches run truly concurrently via `tokio::join!` —
/// creating a future (`fetch_document_full_text(...)` bound to a variable)
/// does not start it running; only polling/awaiting it does, so awaiting them
/// one after another would needlessly multiply the latency of independent
/// round-trips.
///
/// Streams back as `interview-mode:answer-delta` events, finishing with
/// `interview-mode:answer-complete`. Only ever invoked by the frontend in
/// direct response to ASK AI / ENTER — never automatically.
#[tauri::command]
pub async fn ask_interview_question(
    app: AppHandle,
    state: State<'_, AppState>,
    question: String,
    options: Option<AskOptions>,
    history: Option<Vec<PriorTurn>>,
) -> Result<String, String> {
    use crate::hardware::telemetry::{finish, PipelineStage, Stopwatch};

    let question_to_answer = Stopwatch::start();

    let trimmed = question.trim();
    if trimmed.is_empty() {
        return Err("no question text to send".into());
    }
    let options = options.unwrap_or_default();

    let history = trim_history(history.unwrap_or_default());

    let service_available = state.rag_service.lock().map(|slot| slot.is_some()).unwrap_or(false);
    let (resume_text, uploaded_job_description, uploaded_additional_context) = tokio::join!(
        fetch_document_full_text("RESUME", service_available),
        fetch_document_full_text("JOB_DESCRIPTION", service_available),
        fetch_document_full_text("ADDITIONAL_CONTEXT", service_available)
    );

    let request = AskRequest {
        question: trimmed.to_string(),
        conversation_history: history,
        candidate_context: resume_text,
        role: options.role,
        // The uploaded document's full text (when present) is more complete
        // than the settings panel's manually typed/pasted job_description
        // field, so it takes priority; the typed field remains the fallback
        // for users who never uploaded a JD file at all.
        job_description: uploaded_job_description.or(options.job_description),
        additional_context: uploaded_additional_context.or(options.additional_context),
        answer_length: options.answer_length,
        response_style: options.response_style,
        english_level: options.english_level,
        humanization: options.humanization,
        llm_provider: options.llm_provider,
    };

    let app_for_events = app.clone();
    let llm_timer = Stopwatch::start();
    let first_token = crate::hardware::telemetry::FirstTokenTracker::new();
    let first_token_recorder = first_token.recorder();
    let on_delta = move |delta: &str| {
        first_token_recorder.mark();
        let _ = app_for_events.emit("interview-mode:answer-delta", delta);
    };
    let access_token = crate::auth::current_access_token(&state).await?;
    let answer = crate::personal::DirectLlmClient::new(request.llm_provider.as_deref(), access_token)
        .ask_stream(&request, on_delta)
        .await?;

    let ctx = crate::hardware::perf_context(&app);
    if let Some(ms) = first_token.elapsed_ms() {
        crate::hardware::telemetry::log_stage_ms(PipelineStage::LlmFirstToken, ms, &ctx);
    }
    finish(llm_timer, PipelineStage::LlmTotal, &ctx);
    finish(question_to_answer, PipelineStage::QuestionToAnswer, &ctx);

    let _ = app.emit("interview-mode:answer-complete", &answer);
    Ok(answer)
}

/// Fixed label used both as the pending turn's question text (frontend side)
/// and, here, as `AskRequest.question` / the eventual `PriorTurn.question`
/// replayed into later questions' history — there's no real transcribed
/// question for a screen analysis, so this stands in for it consistently on
/// both sides.
pub const ANALYZE_SCREEN_QUESTION_LABEL: &str = "What's on my screen?";

/// Runs the "Analyze Screen" flow: captures the primary screen -> ONE vision
/// LLM call -> stream. Mirrors `ask_interview_question`'s shape and event
/// names (`interview-mode:answer-delta`/`-complete`) so the overlay's
/// existing turn rendering and reveal ticker apply unchanged — the only
/// difference from the frontend's point of view is which command it invokes
/// and that there's no typed/spoken question to send.
#[tauri::command]
pub async fn analyze_screen_question(
    app: AppHandle,
    state: State<'_, AppState>,
    options: Option<AskOptions>,
    history: Option<Vec<PriorTurn>>,
) -> Result<String, String> {
    use crate::hardware::telemetry::{finish, PipelineStage, Stopwatch};
    use base64::Engine;

    let question_to_answer = Stopwatch::start();
    let options = options.unwrap_or_default();
    let history = trim_history(history.unwrap_or_default());

    // Captured (and access-token-checked) before the RAG fetches below, not
    // because either depends on the other, but so a capture failure (no
    // monitor found, driver issue) surfaces immediately rather than after
    // paying for document fetches that would otherwise go to waste.
    let png_bytes = crate::interview_mode::screen::capture_primary_screen_png()?;
    let image_base64 = base64::engine::general_purpose::STANDARD.encode(png_bytes);

    let service_available = state.rag_service.lock().map(|slot| slot.is_some()).unwrap_or(false);
    let (resume_text, uploaded_job_description, uploaded_additional_context) = tokio::join!(
        fetch_document_full_text("RESUME", service_available),
        fetch_document_full_text("JOB_DESCRIPTION", service_available),
        fetch_document_full_text("ADDITIONAL_CONTEXT", service_available)
    );

    let request = AskRequest {
        question: ANALYZE_SCREEN_QUESTION_LABEL.to_string(),
        conversation_history: history,
        candidate_context: resume_text,
        role: options.role,
        job_description: uploaded_job_description.or(options.job_description),
        additional_context: uploaded_additional_context.or(options.additional_context),
        answer_length: options.answer_length,
        response_style: options.response_style,
        english_level: options.english_level,
        humanization: options.humanization,
        llm_provider: options.llm_provider,
    };

    let app_for_events = app.clone();
    let llm_timer = Stopwatch::start();
    let first_token = crate::hardware::telemetry::FirstTokenTracker::new();
    let first_token_recorder = first_token.recorder();
    let on_delta = move |delta: &str| {
        first_token_recorder.mark();
        let _ = app_for_events.emit("interview-mode:answer-delta", delta);
    };
    let access_token = crate::auth::current_access_token(&state).await?;
    let answer = crate::personal::DirectLlmClient::new(request.llm_provider.as_deref(), access_token)
        .ask_screen_stream(&request, image_base64, on_delta)
        .await?;

    let ctx = crate::hardware::perf_context(&app);
    if let Some(ms) = first_token.elapsed_ms() {
        crate::hardware::telemetry::log_stage_ms(PipelineStage::LlmFirstToken, ms, &ctx);
    }
    finish(llm_timer, PipelineStage::LlmTotal, &ctx);
    finish(question_to_answer, PipelineStage::QuestionToAnswer, &ctx);

    let _ = app.emit("interview-mode:answer-complete", &answer);
    Ok(answer)
}

/// Normalizes the overlay's conversation history into what the backend wants:
/// the most recent complete turns, still oldest-first.
///
/// Incomplete turns are dropped rather than sent as empty strings — the
/// backend schema requires non-empty text on both sides, so a turn whose
/// answer failed or is still streaming would be rejected and take the whole
/// request down with it.
fn trim_history(turns: Vec<PriorTurn>) -> Vec<ConversationTurn> {
    let mut history: Vec<ConversationTurn> = turns
        .into_iter()
        .filter(|t| !t.question.trim().is_empty() && !t.answer.trim().is_empty())
        .map(|t| ConversationTurn {
            question: t.question.trim().to_string(),
            answer: t.answer.trim().to_string(),
        })
        .collect();
    if history.len() > MAX_HISTORY_TURNS {
        history.drain(..history.len() - MAX_HISTORY_TURNS);
    }
    history
}

/// Result of `start_backend_session`. Unlike the old BYOK build (where a
/// missing/unreachable backend just meant "keep using your own key locally"),
/// there is no local fallback anymore — the Deepgram key `start_capture_inner`
/// needs comes from this call, so any failure (no remaining minutes, an
/// active session already running elsewhere, not logged in, network/backend
/// unreachable) is a real rejection the frontend must surface and use to
/// stop Start.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendSessionResult {
    /// A user-presentable message explaining why the session couldn't start.
    pub rejection: Option<String>,
    /// True when `rejection` is specifically "you have an active session on
    /// another device" — a resolvable choice, not a dead end. The frontend
    /// should offer to retry with `force: true` (which ends that other
    /// session) rather than just showing this as a plain error.
    pub active_elsewhere: bool,
}

impl BackendSessionResult {
    fn ok() -> Self {
        Self { rejection: None, active_elsewhere: false }
    }

    fn rejected(message: String) -> Self {
        Self { rejection: Some(message), active_elsewhere: false }
    }

    fn active_elsewhere(message: String) -> Self {
        Self { rejection: Some(message), active_elsewhere: true }
    }
}

/// Mints a short-lived, scoped Deepgram key and starts an
/// `interview_sessions` row server-side (see `stt::backend_token::mint`),
/// checking the signed-in user's remaining minutes / concurrent-session
/// limit in the process. Any failure here — out of minutes, an active
/// session already running elsewhere, not logged in, or a network problem
/// reaching the backend — is surfaced as a `rejection`, since (unlike the
/// old BYOK build) there is no local fallback: the Deepgram key used by
/// `start_capture_inner` comes from this call, not a stored user key.
///
/// `force`: when the previous attempt came back with `active_elsewhere` and
/// the user confirmed they want to continue anyway, the frontend calls this
/// again with `force: true` — that other session gets ended server-side
/// (see stt-token's `force` option) and this one takes its place. The
/// device that lost its session finds out via its own heartbeat call (see
/// `run_heartbeat_loop`'s "stt:session-ended-elsewhere" event).
#[tauri::command]
pub async fn start_backend_session(
    app: AppHandle,
    state: State<'_, AppState>,
    _stt_mode: String,
    force: Option<bool>,
) -> Result<BackendSessionResult, String> {
    let access_token = match crate::auth::current_access_token(&state).await {
        Ok(token) => token,
        Err(err) => return Ok(BackendSessionResult::rejected(err)),
    };

    match crate::stt::backend_token::mint(&access_token, force.unwrap_or(false)).await {
        Ok(minted) => {
            let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
            let heartbeat_session_id = minted.session_id.clone();
            tauri::async_runtime::spawn(crate::stt::backend_token::run_heartbeat_loop(
                app,
                access_token,
                heartbeat_session_id,
                cancel_rx,
            ));

            let mut slot = state.stt_session.lock().map_err(|e| e.to_string())?;
            *slot = Some(crate::stt::SttSession {
                session_id: minted.session_id,
                deepgram_key: minted.key,
                started_at: std::time::Instant::now(),
                heartbeat_cancel: Some(cancel_tx),
            });
            Ok(BackendSessionResult::ok())
        }
        Err(err) if err.is_active_elsewhere() => Ok(BackendSessionResult::active_elsewhere(err.message)),
        Err(err) => Ok(BackendSessionResult::rejected(err.message)),
    }
}

/// Reports actual session duration to `usage-report` (decrements the user's
/// minute balance) and stops the heartbeat loop. Best-effort on the network
/// call — a failure here shouldn't block Stop from completing locally.
#[tauri::command]
pub async fn end_backend_session(state: State<'_, AppState>) -> Result<Option<()>, String> {
    let session = {
        let mut slot = state.stt_session.lock().map_err(|e| e.to_string())?;
        slot.take()
    };

    if let Some(mut session) = session {
        if let Some(cancel) = session.heartbeat_cancel.take() {
            let _ = cancel.send(());
        }
        let elapsed_seconds = session.started_at.elapsed().as_secs_f64();
        if let Ok(access_token) = crate::auth::current_access_token(&state).await {
            if let Err(err) = crate::stt::backend_token::report_usage(&access_token, &session.session_id, elapsed_seconds).await {
                log::warn!("failed to report interview session usage: {err}");
            }
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(q: &str, a: &str) -> PriorTurn {
        PriorTurn {
            question: q.to_string(),
            answer: a.to_string(),
        }
    }

    #[test]
    fn history_keeps_the_most_recent_turns_oldest_first() {
        let turns: Vec<PriorTurn> = (0..MAX_HISTORY_TURNS + 3)
            .map(|i| turn(&format!("q{i}"), &format!("a{i}")))
            .collect();
        let trimmed = trim_history(turns);

        assert_eq!(trimmed.len(), MAX_HISTORY_TURNS);
        // The oldest turns are the ones dropped, and order is preserved.
        assert_eq!(trimmed.first().unwrap().question, "q3");
        assert_eq!(trimmed.last().unwrap().question, format!("q{}", MAX_HISTORY_TURNS + 2));
    }

    #[test]
    fn history_drops_incomplete_turns() {
        // A turn still streaming, or one whose request failed, has no answer.
        // Sending it would fail the backend's min_length validation and take
        // the whole follow-up down with it.
        let trimmed = trim_history(vec![
            turn("answered", "yes"),
            turn("still streaming", ""),
            turn("", "orphan answer"),
            turn("  ", "   "),
        ]);
        assert_eq!(trimmed.len(), 1);
        assert_eq!(trimmed[0].question, "answered");
    }

    #[test]
    fn history_is_trimmed_of_whitespace() {
        let trimmed = trim_history(vec![turn("  why?  ", "  because.  ")]);
        assert_eq!(trimmed[0].question, "why?");
        assert_eq!(trimmed[0].answer, "because.");
    }

    #[test]
    fn empty_history_is_fine() {
        assert!(trim_history(Vec::new()).is_empty());
    }

    #[test]
    fn ask_options_default_to_natural_default_length() {
        let options = AskOptions::default();
        assert_eq!(options.answer_length, "default");
        assert_eq!(options.response_style, "natural");
        assert!(options.role.is_none());
    }

    #[test]
    fn ask_options_deserialize_from_partial_frontend_payload() {
        let options: AskOptions = serde_json::from_str(r#"{"answerLength":"brief"}"#).unwrap();
        assert_eq!(options.answer_length, "brief");
        assert_eq!(options.response_style, "natural");
    }
}
