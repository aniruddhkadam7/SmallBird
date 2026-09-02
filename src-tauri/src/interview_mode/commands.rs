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
    let answer = crate::personal::DirectLlmClient::new(request.llm_provider.as_deref())?
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

/// Result of `start_backend_session`, distinguishing "the backend explicitly
/// said no" (`rejection` set — Start should stop) from every other outcome
/// (not signed in, credential store unavailable, network unreachable,
/// backend down — `rejection` is `None` and local recording should proceed
/// exactly as it always has). This feature has NO business blocking local
/// STT for any reason other than an actual entitlement decision — collapsing
/// every failure into one error type is what previously let an unrelated
/// infrastructure hiccup (e.g. Windows Credential Manager being briefly
/// unavailable) silently prevent recording from ever starting.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BackendSessionResult {
    /// Present only for a genuine backend rejection (no remaining minutes,
    /// concurrent session limit) — a user-presentable message the frontend
    /// should surface and use to stop Start.
    pub rejection: Option<String>,
}

impl BackendSessionResult {
    fn ok() -> Self {
        Self { rejection: None }
    }

    fn rejected(message: String) -> Self {
        Self { rejection: Some(message) }
    }
}

/// This is a personal build: there is no SaaS backend, no Supabase sign-in,
/// and no entitlement/session-authority system to check in with. These two
/// commands are kept as permanent no-ops (rather than removed) so the
/// frontend call sites around Start/Stop Interview — which call them
/// unconditionally — need no changes.
#[tauri::command]
pub async fn start_backend_session(
    _state: State<'_, AppState>,
    _stt_mode: String,
) -> Result<BackendSessionResult, String> {
    Ok(BackendSessionResult::ok())
}

#[tauri::command]
pub async fn end_backend_session(_state: State<'_, AppState>) -> Result<Option<()>, String> {
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
