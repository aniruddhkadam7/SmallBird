//! Tauri commands for Interview Mode: overlay window lifecycle + the
//! ASK AI flow (uploaded CV/job-description full text -> LLM -> streamed
//! answer).

use tauri::{AppHandle, Emitter, Manager, State};

use crate::auth::client::{SUPABASE_ANON_KEY, SUPABASE_URL};
use crate::backend::{AskRequest, ConversationStateSnapshot, ConversationTurn, MeetingContext};
use crate::state::AppState;

use super::window::{self, OverlayCaptureStatus};
use crate::crash_guard::LockExt;

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
    pub company: Option<String>,
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
    /// "interview" | "meeting" | "assistant" | "custom:<id>" — the header's
    /// mode dropdown. Meeting mode swaps the candidate persona and resume/JD
    /// context for the meeting's own purpose, participants and uploaded
    /// meeting documents; a custom mode is one the user created (see the
    /// frontend's customModes.ts).
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default)]
    pub meeting_topic: Option<String>,
    #[serde(default)]
    pub participants: Option<String>,
    /// A custom mode's name and "how to act" role, sent alongside its
    /// `custom:<id>` mode.
    #[serde(default)]
    pub custom_mode_name: Option<String>,
    #[serde(default)]
    pub custom_mode_role: Option<String>,
    /// The overlay's "Deep Answer" (button / Ctrl+D): slower, stronger
    /// reasoning model for questions that deserve it. Off for every normal
    /// Answer / Auto Answer.
    #[serde(default)]
    pub deep: bool,
    /// The overlay's Mic is on, so the question arrives as "Them:" / "You:"
    /// labeled lines.
    #[serde(default)]
    pub speaker_labeled: bool,
}

fn default_mode() -> String {
    "interview".to_string()
}

fn default_answer_length() -> String {
    "detailed".to_string()
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
            company: None,
            job_description: None,
            additional_context: None,
            english_level: default_english_level(),
            humanization: default_humanization(),
            llm_provider: None,
            mode: default_mode(),
            meeting_topic: None,
            participants: None,
            custom_mode_name: None,
            custom_mode_role: None,
            deep: false,
            speaker_labeled: false,
        }
    }
}

/// Builds the `AskRequest` shared by Ask AI and Analyze Screen, reading the
/// uploaded documents that belong to the session's mode. Interview and
/// Meeting documents use distinct document types (see the frontend's
/// `headerPopups.ts`), so neither mode ever picks up the other's uploads.
fn build_ask_request(
    state: &AppState,
    question: String,
    options: AskOptions,
    history: Vec<ConversationTurn>,
    conversation_state: ConversationStateSnapshot,
) -> AskRequest {
    let is_meeting = options.mode == "meeting";
    // A custom mode runs on Assistant Mode's pipeline, with the user's own
    // role in place of the assistant persona and its own document types
    // (CUSTOM_*:<id>), so no two modes ever share uploads.
    let custom_id = options.mode.strip_prefix("custom:").filter(|id| !id.is_empty());
    let is_assistant = options.mode == "assistant" || custom_id.is_some();
    // Each mode keeps its own instructions (see the frontend's
    // headerPopups.ts), since "answer as a senior candidate" and "keep my
    // meeting replies to one line" rarely belong together.
    let custom_instructions = crate::documents::latest_ready_text(
        state,
        &match custom_id {
            Some(id) => format!("CUSTOM_INSTRUCTIONS:{id}"),
            None if is_assistant => "ASSISTANT_INSTRUCTIONS".to_string(),
            None if is_meeting => "MEETING_INSTRUCTIONS".to_string(),
            None => "INTERVIEW_INSTRUCTIONS".to_string(),
        },
    );
    // Assistant Mode reads only its own document types, so nothing from an
    // interview or meeting (resume, agenda, ...) reaches it, or vice versa.
    let assistant = is_assistant.then(|| crate::backend::AssistantContext {
        notes: crate::documents::latest_ready_text(
            state,
            &custom_id.map_or_else(|| "ASSISTANT_CONTEXT".to_string(), |id| format!("CUSTOM_CONTEXT:{id}")),
        ),
        custom: custom_id.map(|_| crate::backend::CustomModeContext {
            name: options.custom_mode_name.clone().unwrap_or_default(),
            role: options.custom_mode_role.clone(),
        }),
    });
    let meeting = is_meeting.then(|| MeetingContext {
        topic: options.meeting_topic.clone(),
        participants: options.participants.clone(),
        agenda: crate::documents::latest_ready_text(state, "MEETING_AGENDA"),
        documents: crate::documents::latest_ready_text(state, "MEETING_DOCUMENTS"),
        knowledge_base: crate::documents::latest_ready_text(state, "KNOWLEDGE_BASE"),
        previous_notes: crate::documents::latest_ready_text(state, "PREVIOUS_MEETING_NOTES"),
    });

    let (candidate_context, role, company, job_description, additional_context) = if is_meeting || is_assistant {
        (None, None, None, None, None)
    } else {
        (
            crate::documents::latest_ready_text(state, "RESUME"),
            options.role,
            options.company,
            // The uploaded document's full text (when present) is more
            // complete than the settings panel's manually typed/pasted
            // job_description field, so it takes priority; the typed field
            // remains the fallback for users who never uploaded a JD file.
            crate::documents::latest_ready_text(state, "JOB_DESCRIPTION").or(options.job_description),
            crate::documents::latest_ready_text(state, "ADDITIONAL_CONTEXT").or(options.additional_context),
        )
    };

    AskRequest {
        question,
        conversation_history: history,
        candidate_context,
        role,
        company,
        job_description,
        additional_context,
        answer_length: options.answer_length,
        response_style: options.response_style,
        english_level: options.english_level,
        humanization: options.humanization,
        llm_provider: options.llm_provider,
        conversation_state: Some(conversation_state),
        meeting,
        custom_instructions,
        deep: options.deep,
        images: Vec::new(),
        speaker_labeled: options.speaker_labeled,
        assistant,
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

/// The overlay's Minimize button: shrinks it into a small box in the
/// bottom-right corner. The session keeps running. `strip`: the box's own
/// minimize button, folding it down to just its top strip.
#[tauri::command]
pub async fn minimize_interview_overlay(app: AppHandle, strip: Option<bool>) -> Result<(), String> {
    let strip = strip.unwrap_or(false);
    run_on_main(&app, move |app| window::minimize_overlay(app, strip)).await
}

/// The overlay's maximize button. Returns whether it's now maximized.
#[tauri::command]
pub async fn toggle_maximize_interview_overlay(app: AppHandle) -> Result<bool, String> {
    run_on_main(&app, window::toggle_maximize_overlay).await
}

/// Clicking the minimized box: back to the full overlay, where it was.
#[tauri::command]
pub async fn restore_interview_overlay(app: AppHandle) -> Result<(), String> {
    run_on_main(&app, window::restore_overlay).await
}

/// Website origin — base for both the plain dashboard URL (signed-out
/// fallback) and the handoff URL below.
const WEBSITE_ORIGIN: &str = "https://smallbirdai.com";

/// Requests a one-time magic-link token from the `dashboard-handoff`
/// Supabase function for the signed-in user, so the browser "Open Dashboard"
/// opens can be signed in too instead of showing the website's own login
/// screen for a session the user already has here. Returns `None` (never an
/// `Err`) for anything that keeps this from working — no token to hand back,
/// a network hiccup, the function being unreachable — since the plain
/// dashboard URL is always a perfectly good fallback and this must never be
/// what blocks the button.
async fn fetch_dashboard_handoff_token(access_token: &str) -> Option<String> {
    #[derive(serde::Deserialize)]
    struct HandoffResponse {
        #[serde(rename = "tokenHash")]
        token_hash: Option<String>,
    }

    let response = reqwest::Client::new()
        .post(format!("{SUPABASE_URL}/functions/v1/dashboard-handoff"))
        .header("apikey", SUPABASE_ANON_KEY)
        .bearer_auth(access_token)
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }
    response.json::<HandoffResponse>().await.ok()?.token_hash
}

/// Opens the website's Interviews dashboard in the system browser — signed
/// in already, when the user is signed in here and the handoff round-trip
/// succeeds (see fetch_dashboard_handoff_token); otherwise just the plain
/// dashboard URL, which shows the website's own sign-in prompt like any
/// first-time visit. Uses the opener plugin directly from Rust rather than a
/// frontend-invoked plugin command, same pattern as auth::oauth's
/// login_with_google — no separate "opener" capability entry needed since
/// this custom command is what's exposed to the frontend, not the plugin's
/// own command.
#[tauri::command]
pub async fn open_dashboard(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    open_website_page(&app, &state, "dashboard").await
}

/// "Upgrade" on an out-of-minutes message: the website's pricing page,
/// signed in (same hand-off as the dashboard), so buying more minutes is one
/// click away.
#[tauri::command]
pub async fn open_upgrade(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    open_website_page(&app, &state, "pricing").await
}

/// Opens `{WEBSITE_ORIGIN}/{page}` in the browser, signed in when possible.
/// `page` is a fixed path from this file (letters only), never user input.
async fn open_website_page(app: &AppHandle, state: &State<'_, AppState>, page: &str) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let url = match crate::auth::current_access_token(state).await {
        Ok(access_token) => match fetch_dashboard_handoff_token(&access_token).await {
            // token_hash is a hex-encoded hash (Supabase's OTP hashed_token)
            // — always in [0-9a-f], so it needs no percent-encoding here.
            Some(token_hash) => format!("{WEBSITE_ORIGIN}/auth/handoff?token_hash={token_hash}&next=%2F{page}"),
            None => format!("{WEBSITE_ORIGIN}/{page}"),
        },
        Err(_) => format!("{WEBSITE_ORIGIN}/{page}"),
    };

    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| format!("could not open the website: {e}"))
}

/// Applied immediately when the user flips "Always on top" in the overlay's
/// Settings panel — see `overlaySettings.ts`/`OverlaySettingsPanel.tsx`.
#[tauri::command]
pub async fn set_overlay_always_on_top(app: AppHandle, enabled: bool) -> Result<(), String> {
    run_on_main(&app, move |app| window::set_overlay_always_on_top(app, enabled)).await
}

/// Applied when the user flips "Screen Capture Protection" in Settings —
/// previously that row only ever displayed status, with no way to actually
/// turn it off. See `overlay_window::set_overlay_capture_exclusion`'s doc
/// comment for why someone would want to: legacy screen-share/screenshot
/// pipelines render an excluded window as a black box rather than properly
/// hiding it, and that's a Windows-level fallback neither side of this call
/// can prevent — turning protection off trades that surprise for the window
/// being plainly visible instead.
#[tauri::command]
pub async fn set_overlay_capture_exclusion(app: AppHandle, enabled: bool) -> Result<OverlayCaptureStatus, String> {
    run_on_main(&app, move |app| window::set_overlay_capture_exclusion(app, enabled)).await
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

/// Runs the ASK AI flow for a single question: question -> ONE LLM call ->
/// stream.
///
/// The uploaded CV, job description, and additional context, if any, are
/// read as full text (see `documents::latest_ready_text`) and sent on every
/// question — a plain in-memory lookup now that document extraction runs
/// in-process rather than via an external service.
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
    screenshot_ids: Option<Vec<String>>,
) -> Result<String, String> {
    use crate::hardware::telemetry::{finish, PipelineStage, Stopwatch};

    let question_to_answer = Stopwatch::start();

    let images = take_screenshots(&state, &screenshot_ids.unwrap_or_default())?;
    let trimmed = match question.trim() {
        "" if images.is_empty() => return Err("no question text to send".into()),
        "" => ANALYZE_SCREEN_QUESTION_LABEL,
        text => text,
    };
    let options = options.unwrap_or_default();

    let is_fresh_session = history.as_ref().map(|h| h.is_empty()).unwrap_or(true);
    let history = trim_history(history.unwrap_or_default());
    let conversation_state = current_conversation_state(&state, is_fresh_session)?;

    let mut request = build_ask_request(&state, trimmed.to_string(), options, history, conversation_state.clone());
    request.images = images;

    let app_for_events = app.clone();
    let llm_timer = Stopwatch::start();
    let first_token = crate::hardware::telemetry::FirstTokenTracker::new();
    let first_token_recorder = first_token.recorder();
    let on_delta = move |delta: &str| {
        first_token_recorder.mark();
        let _ = app_for_events.emit("interview-mode:answer-delta", delta);
    };
    let access_token = crate::auth::current_access_token(&state).await?;
    let answer = crate::personal::DirectLlmClient::new(request.llm_provider.as_deref(), access_token.clone())
        .ask_stream(&request, on_delta)
        .await?;
    // Safety net for when the model organizes the answer correctly but skips
    // the actual Markdown syntax — see `personal::format_fixup` for why this
    // exists. The raw streamed deltas above are unaffected (still live,
    // unprocessed text as it arrives); only this final, authoritative answer
    // is corrected.
    let answer = crate::personal::format_fixup::ensure_markdown_structure(&answer);

    if request.assistant.is_none() {
        spawn_conversation_state_update(app.clone(), access_token, request.llm_provider.clone(), conversation_state, request.question.clone(), answer.clone());
    }

    let ctx = crate::hardware::perf_context(&app);
    if let Some(ms) = first_token.elapsed_ms() {
        crate::hardware::telemetry::log_stage_ms(PipelineStage::LlmFirstToken, ms, &ctx);
    }
    finish(llm_timer, PipelineStage::LlmTotal, &ctx);
    finish(question_to_answer, PipelineStage::QuestionToAnswer, &ctx);

    let _ = app.emit("interview-mode:answer-complete", &answer);
    Ok(answer)
}

/// Reads the persisted long-range conversation state, resetting it first
/// when this is the first question of a fresh Interview Mode session (the
/// frontend sends empty history for the first question of every new
/// overlay session) — otherwise state left over from a previous, unrelated
/// interview would leak into this one.
fn current_conversation_state(state: &State<'_, AppState>, is_fresh_session: bool) -> Result<ConversationStateSnapshot, String> {
    let mut slot = state.conversation_state.lock_safe();
    if is_fresh_session {
        *slot = ConversationStateSnapshot::default();
    }
    Ok(slot.clone())
}

/// Fire-and-forget background update of the persisted conversation state
/// (see `ConversationStateSnapshot` and `personal::DirectLlmClient::update_conversation_state`).
/// Runs after the answer has already been streamed back, so it never adds
/// latency to the response the user is waiting on; any failure here is
/// silently ignored — the next question just keeps using the state as of
/// before this turn, which is a safe degrade.
fn spawn_conversation_state_update(app: AppHandle, access_token: String, llm_provider: Option<String>, prior_state: ConversationStateSnapshot, question: String, answer: String) {
    tauri::async_runtime::spawn(async move {
        let client = crate::personal::DirectLlmClient::new(llm_provider.as_deref(), access_token);
        if let Some(updated) = client.update_conversation_state(&prior_state, &question, &answer).await {
            let state = app.state::<AppState>();
            *state.conversation_state.lock_safe() = updated;
        }
    });
}

/// Fixed label used both as the pending turn's question text (frontend side)
/// and, here, as `AskRequest.question` / the eventual `PriorTurn.question`
/// replayed into later questions' history — there's no real transcribed
/// question for a screen analysis, so this stands in for it consistently on
/// both sides.
pub const ANALYZE_SCREEN_QUESTION_LABEL: &str = crate::personal::prompts::screen::SCREEN_QUESTION_LABEL;

/// Most screenshots one question can carry — each is roughly a thousand
/// input tokens, and past a handful the model reads them less carefully.
const MAX_PENDING_SCREENSHOTS: usize = 8;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotInfo {
    pub id: String,
    /// Small PNG data URL for the overlay's thumbnail strip.
    pub thumbnail: String,
}

/// The overlay's Screenshot button: grabs the screen (the overlay itself is
/// excluded from capture) and keeps it for the next Answer — no model call.
/// Runs the capture/encode on a blocking worker so rapid taps never queue
/// behind each other on the command thread.
#[tauri::command]
pub async fn capture_screenshot(state: State<'_, AppState>) -> Result<ScreenshotInfo, String> {
    if state.screenshots.lock_safe().len() >= MAX_PENDING_SCREENSHOTS {
        return Err(format!("Up to {MAX_PENDING_SCREENSHOTS} screenshots per question — send or remove some first."));
    }
    let shot = tauri::async_runtime::spawn_blocking(crate::interview_mode::screen::capture_shot)
        .await
        .map_err(|e| format!("screenshot task failed: {e}"))??;
    let id = format!(
        "shot-{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
    );
    state.screenshots.lock_safe().push((id.clone(), shot.image_base64));
    Ok(ScreenshotInfo { id, thumbnail: shot.thumbnail_data_url })
}

#[tauri::command]
pub fn remove_screenshot(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.screenshots.lock_safe().retain(|(shot_id, _)| *shot_id != id);
    Ok(())
}

#[tauri::command]
pub fn clear_screenshots(state: State<'_, AppState>) -> Result<(), String> {
    state.screenshots.lock_safe().clear();
    Ok(())
}

/// Removes the named pending screenshots and returns their images in the
/// order given — they're consumed by the question they're sent with.
fn take_screenshots(state: &AppState, ids: &[String]) -> Result<Vec<String>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut pending = state.screenshots.lock_safe();
    let images = ids
        .iter()
        .filter_map(|id| pending.iter().find(|(shot_id, _)| shot_id == id).map(|(_, png)| png.clone()))
        .collect();
    pending.retain(|(shot_id, _)| !ids.contains(shot_id));
    Ok(images)
}

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
    let is_fresh_session = history.as_ref().map(|h| h.is_empty()).unwrap_or(true);
    let history = trim_history(history.unwrap_or_default());
    let conversation_state = current_conversation_state(&state, is_fresh_session)?;

    let png_bytes = crate::interview_mode::screen::capture_primary_screen_png()?;
    let image_base64 = base64::engine::general_purpose::STANDARD.encode(png_bytes);

    let request = build_ask_request(&state, ANALYZE_SCREEN_QUESTION_LABEL.to_string(), options, history, conversation_state.clone());

    let app_for_events = app.clone();
    let llm_timer = Stopwatch::start();
    let first_token = crate::hardware::telemetry::FirstTokenTracker::new();
    let first_token_recorder = first_token.recorder();
    let on_delta = move |delta: &str| {
        first_token_recorder.mark();
        let _ = app_for_events.emit("interview-mode:answer-delta", delta);
    };
    let access_token = crate::auth::current_access_token(&state).await?;
    let answer = crate::personal::DirectLlmClient::new(request.llm_provider.as_deref(), access_token.clone())
        .ask_screen_stream(&request, image_base64, on_delta)
        .await?;
    let answer = crate::personal::format_fixup::ensure_markdown_structure(&answer);

    if request.assistant.is_none() {
        spawn_conversation_state_update(app.clone(), access_token, request.llm_provider.clone(), conversation_state, request.question.clone(), answer.clone());
    }

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

            let mut slot = state.stt_session.lock_safe();
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
        let mut slot = state.stt_session.lock_safe();
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
    fn ask_options_default_to_natural_detailed_length() {
        // "detailed" is the intended default (see `default_answer_length`,
        // matching overlaySettings.ts's v5 default) — this test predated it.
        let options = AskOptions::default();
        assert_eq!(options.answer_length, "detailed");
        assert_eq!(options.response_style, "natural");
        assert!(options.role.is_none());
    }

    #[test]
    fn ask_options_deserialize_from_partial_frontend_payload() {
        let options: AskOptions = serde_json::from_str(r#"{"answerLength":"brief"}"#).unwrap();
        assert_eq!(options.answer_length, "brief");
        assert_eq!(options.response_style, "natural");
        assert_eq!(options.mode, "interview");
    }

    #[test]
    fn ask_options_deserialize_meeting_fields() {
        let options: AskOptions =
            serde_json::from_str(r#"{"mode":"meeting","meetingTopic":"Q3 roadmap","participants":"Priya"}"#).unwrap();
        assert_eq!(options.mode, "meeting");
        assert_eq!(options.meeting_topic.as_deref(), Some("Q3 roadmap"));
        assert_eq!(options.participants.as_deref(), Some("Priya"));
    }

    #[test]
    fn ask_options_deserialize_custom_mode_fields() {
        let options: AskOptions = serde_json::from_str(
            r#"{"mode":"custom:abc123","customModeName":"Sales calls","customModeRole":"Act as me, an account executive"}"#,
        )
        .unwrap();
        assert_eq!(options.mode, "custom:abc123");
        assert_eq!(options.custom_mode_name.as_deref(), Some("Sales calls"));
        assert_eq!(options.custom_mode_role.as_deref(), Some("Act as me, an account executive"));
    }
}
