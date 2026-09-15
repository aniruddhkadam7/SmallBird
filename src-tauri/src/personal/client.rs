//! `DirectLlmClient` — same method set and request/response struct types
//! (`backend::types`) as before, but every call now routes through the
//! deployed `llm-proxy` Supabase Edge Function using the signed-in user's
//! access token, instead of calling the provider directly with a
//! locally-stored API key. See `providers::openai`/`providers::anthropic`
//! for the actual HTTP call.

use crate::backend::{
    AskRequest, AskResponse, ConversationStateSnapshot, InterviewAnalysisRequest, NoteSummary, NotesAskRequest,
    NotesAskResponse, NotesSummaryRequest, OverallInterviewAnalysis, QuestionAnalysis, SetupAnalysisRequest,
    SetupAnalysisResponse,
};

use super::prompts::{analysis, ask, notes, screen, setup, state_tracker, ChatMessage};
use super::provider::LlmProvider;
use super::providers::{anthropic, openai};

/// Default model per provider (`settings.ask_model`/`settings.llm_model`
/// fall back to a generic model-shaped string; Anthropic's own
/// `resolve_model` guard substitutes its real default when that doesn't
/// apply, so this default only matters for OpenAI, where no substitution
/// happens). Tried the whole GPT-5 reasoning family (mini, at "minimal",
/// "low", and "none" reasoning_effort) and none of them reliably produced
/// Markdown — confirmed live, and consistent with OpenAI's own docs that
/// GPT-5-family models suppress Markdown in API mode independent of
/// reasoning effort, while every effort level above "minimal" also adds
/// real per-question latency. `gpt-4o` isn't a reasoning model at all — a
/// single forward pass (fast, no reasoning-token overhead, no
/// `reasoning_effort`/`max_completion_tokens` workarounds needed) and not
/// subject to that Markdown-suppression bias, so it's the pick for both
/// speed and formatting together. `gpt-4o-mini` was tried as a faster
/// alternative (live telemetry showed 3-5.7s time-to-first-token on `gpt-4o`
/// for this prompt size) but produced noticeably vaguer answers live —
/// e.g. restating the asked-about category ("Retrieval Performance
/// Metrics") instead of naming real, specific frameworks/tools — which is a
/// worse failure than the extra seconds during a live interview.
fn default_model(provider: LlmProvider) -> &'static str {
    match provider {
        LlmProvider::OpenAi => "gpt-4o",
        LlmProvider::Anthropic => "claude-sonnet-5",
    }
}

pub struct DirectLlmClient {
    provider: LlmProvider,
    access_token: String,
}

impl DirectLlmClient {
    /// `provider` defaults to OpenAI — the same default
    /// `llmProviderSetting.ts` uses — when the caller doesn't name one
    /// explicitly (e.g. Notes ask's request schema has no `llm_provider`
    /// field). TODO: switch both defaults to Anthropic once an
    /// ANTHROPIC_API_KEY secret is set — OpenAI is the default only because
    /// it's the provider with a funded key so far. `access_token` is the
    /// caller's already-fetched, already-valid Supabase session token (see
    /// `crate::auth::current_access_token`) — unlike the removed BYOK
    /// version, this never fails to construct, since there's no local key
    /// lookup to fail; a missing/expired session is the caller's problem to
    /// surface before ever reaching here.
    pub fn new(provider: Option<&str>, access_token: String) -> Self {
        let provider = provider.and_then(LlmProvider::from_wire_str).unwrap_or(LlmProvider::OpenAi);
        Self { provider, access_token }
    }

    async fn generate(&self, messages: &[ChatMessage], temperature: f32, max_tokens: u32) -> Result<String, String> {
        let model = default_model(self.provider);
        match self.provider {
            LlmProvider::OpenAi => openai::generate(&self.access_token, model, messages, temperature, max_tokens).await,
            LlmProvider::Anthropic => anthropic::generate(&self.access_token, model, messages, temperature, max_tokens).await,
        }
    }

    async fn stream<F>(&self, messages: &[ChatMessage], temperature: f32, max_tokens: u32, on_delta: F) -> Result<(), String>
    where
        F: FnMut(&str),
    {
        let model = default_model(self.provider);
        match self.provider {
            LlmProvider::OpenAi => openai::stream(&self.access_token, model, messages, temperature, max_tokens, on_delta).await,
            LlmProvider::Anthropic => anthropic::stream(&self.access_token, model, messages, temperature, max_tokens, on_delta).await,
        }
    }

    // ---- Interview Mode ask ----

    pub async fn ask(&self, request: &AskRequest) -> Result<AskResponse, String> {
        let messages = ask::build_messages(request);
        let max_tokens = ask::max_tokens_for_question(request);
        let answer = self.generate(&messages, 0.65, max_tokens).await?;
        Ok(AskResponse { answer: answer.trim().to_string(), latency_ms: 0.0 })
    }

    pub async fn ask_stream<F>(&self, request: &AskRequest, mut on_delta: F) -> Result<String, String>
    where
        F: FnMut(&str),
    {
        let messages = ask::build_messages(request);
        let max_tokens = ask::max_tokens_for_question(request);
        let mut full_answer = String::new();
        self.stream(&messages, 0.65, max_tokens, |delta| {
            full_answer.push_str(delta);
            on_delta(delta);
        })
        .await?;
        Ok(full_answer)
    }

    /// "Analyze Screen": one vision LLM call over a screenshot (see
    /// `interview_mode::screen::capture_primary_screen_png`), streamed the
    /// same way as `ask_stream`.
    pub async fn ask_screen_stream<F>(&self, request: &AskRequest, image_png_base64: String, mut on_delta: F) -> Result<String, String>
    where
        F: FnMut(&str),
    {
        let messages = screen::build_messages(request, image_png_base64);
        let mut full_answer = String::new();
        self.stream(&messages, 0.65, screen::MAX_TOKENS, |delta| {
            full_answer.push_str(delta);
            on_delta(delta);
        })
        .await?;
        Ok(full_answer)
    }

    /// Updates the persisted conversation-state snapshot (topic/entity/
    /// referenced entities — see `backend::ConversationStateSnapshot`) after
    /// an answer has already been streamed back to the user. Called
    /// fire-and-forget from a spawned task (see
    /// `interview_mode::commands::ask_interview_question`) so this extra
    /// call never adds latency to the answer the user is waiting on. Returns
    /// `None` on any failure (network error, unparseable response) — the
    /// caller then simply keeps using the prior state for the next
    /// question, which is a safe degrade, not a user-visible error.
    pub async fn update_conversation_state(&self, prior: &ConversationStateSnapshot, question: &str, answer: &str) -> Option<ConversationStateSnapshot> {
        let messages = state_tracker::build_messages(prior, question, answer);
        let raw = self.generate(&messages, 0.0, state_tracker::MAX_TOKENS).await.ok()?;
        state_tracker::parse_response(prior, &raw)
    }

    // ---- Interview analysis ----

    pub async fn analyze(&self, request: &InterviewAnalysisRequest) -> Result<OverallInterviewAnalysis, String> {
        const MAX_QUESTIONS_TO_ANALYZE: usize = 50;
        const MAX_OUTPUT_TOKENS: u32 = 1500;

        let questions = analysis::questions_to_analyze(request, MAX_QUESTIONS_TO_ANALYZE);
        let mut question_analyses: Vec<QuestionAnalysis> = Vec::with_capacity(questions.len());
        for qa in questions {
            question_analyses.push(self.analyze_one_question(qa, request, MAX_OUTPUT_TOKENS).await);
        }
        self.finalize(question_analyses, &request.session_id, request, MAX_OUTPUT_TOKENS).await
    }

    pub async fn analyze_stream<F>(&self, request: &InterviewAnalysisRequest, mut on_event: F) -> Result<OverallInterviewAnalysis, String>
    where
        F: FnMut(&crate::backend::AnalysisProgressEvent),
    {
        use crate::backend::AnalysisProgressEvent;
        const MAX_QUESTIONS_TO_ANALYZE: usize = 50;
        const MAX_OUTPUT_TOKENS: u32 = 1500;

        on_event(&AnalysisProgressEvent { stage: "transcript".to_string(), detail: "Processing transcript...".to_string(), question_analysis: None, result: None });

        let questions = analysis::questions_to_analyze(request, MAX_QUESTIONS_TO_ANALYZE);
        on_event(&AnalysisProgressEvent {
            stage: "retrieval".to_string(),
            detail: format!("Retrieved context for {} questions.", questions.len()),
            question_analysis: None,
            result: None,
        });

        let mut question_analyses: Vec<QuestionAnalysis> = Vec::with_capacity(questions.len());
        let total = questions.len();
        for (i, qa) in questions.iter().enumerate() {
            on_event(&AnalysisProgressEvent { stage: "question".to_string(), detail: format!("Analyzing question {} of {total}...", i + 1), question_analysis: None, result: None });
            let analysis = self.analyze_one_question(qa, request, MAX_OUTPUT_TOKENS).await;
            question_analyses.push(analysis.clone());
            on_event(&AnalysisProgressEvent {
                stage: "question_complete".to_string(),
                detail: format!("Completed question {} of {total}.", i + 1),
                question_analysis: Some(analysis),
                result: None,
            });
        }

        on_event(&AnalysisProgressEvent { stage: "overall".to_string(), detail: "Generating overall assessment...".to_string(), question_analysis: None, result: None });
        let result = self.finalize(question_analyses, &request.session_id, request, MAX_OUTPUT_TOKENS).await?;
        on_event(&AnalysisProgressEvent { stage: "complete".to_string(), detail: "Analysis complete.".to_string(), question_analysis: None, result: Some(result.clone()) });

        Ok(result)
    }

    async fn analyze_one_question(&self, qa: &crate::backend::WireQuestionAnswer, request: &InterviewAnalysisRequest, max_output_tokens: u32) -> QuestionAnalysis {
        let (system_prompt, user_prompt) = analysis::build_question_prompt(qa, &request.role, &request.company, &request.job_description);
        let messages = analysis::question_messages(&system_prompt, &user_prompt);
        match self.generate(&messages, 0.2, max_output_tokens).await {
            Ok(raw) => analysis::parse_question_analysis(&raw, qa),
            Err(err) => analysis::provider_failure_question_analysis(qa, err),
        }
    }

    async fn finalize(&self, question_analyses: Vec<QuestionAnalysis>, session_id: &str, request: &InterviewAnalysisRequest, max_output_tokens: u32) -> Result<OverallInterviewAnalysis, String> {
        if question_analyses.is_empty() {
            return Ok(analysis::finalize_empty(session_id));
        }

        let (system_prompt, user_prompt) = analysis::build_overall_prompt(&question_analyses, &request.role, &request.company, &request.job_description);
        let messages = analysis::question_messages(&system_prompt, &user_prompt);

        match self.generate(&messages, 0.2, max_output_tokens).await {
            Ok(raw) => match analysis::parse_overall_result(&raw, question_analyses.clone(), session_id) {
                Ok(result) => Ok(result),
                Err(err) => Ok(analysis::average_score_fallback(question_analyses, session_id, &err)),
            },
            Err(err) => Ok(analysis::average_score_fallback(question_analyses, session_id, &err)),
        }
    }

    // ---- Notes Mode ----

    pub async fn notes_ask(&self, request: &NotesAskRequest) -> Result<NotesAskResponse, String> {
        let messages = notes::build_ask_messages(request);
        // Notes ask has no try/except in the reference implementation — a
        // provider failure propagates as an Err here too, matching that.
        let answer = self.generate(&messages, 0.65, notes::ASK_MAX_TOKENS).await?;
        Ok(NotesAskResponse { answer: answer.trim().to_string(), latency_ms: 0.0 })
    }

    pub async fn notes_summarize(&self, request: &NotesSummaryRequest) -> Result<NoteSummary, String> {
        let messages = notes::build_summary_messages(request);
        const MAX_OUTPUT_TOKENS: u32 = 1500;
        match self.generate(&messages, 0.2, MAX_OUTPUT_TOKENS).await {
            Ok(raw) => match notes::parse_summary(&raw) {
                Ok(summary) => Ok(summary),
                Err(err) => Ok(notes::summary_failure(&err)),
            },
            Err(err) => Ok(notes::summary_failure(&err)),
        }
    }

    // ---- Setup analysis ----

    pub async fn analyze_setup(&self, request: &SetupAnalysisRequest) -> Result<SetupAnalysisResponse, String> {
        let Some(messages) = setup::build_messages(request) else {
            return Ok(setup::empty_response());
        };
        match self.generate(&messages, setup::TEMPERATURE, setup::MAX_TOKENS).await {
            Ok(raw) => Ok(setup::parse_response(&raw)),
            Err(_) => Ok(setup::empty_response()),
        }
    }
}
