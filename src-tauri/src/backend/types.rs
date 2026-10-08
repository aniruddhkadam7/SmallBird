//! Wire types for the `POST /api/v1/interviews/analyze` (and
//! `/analyze/stream`) request/response, matching
//! `apps/backend/app/schemas/interview.py` and
//! `apps/backend/app/schemas/analysis.py` field-for-field.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WireAudioSource {
    SystemAudio,
    Microphone,
}

#[derive(Debug, Clone, Serialize)]
pub struct WireTranscriptSegment {
    /// MM:SS or HH:MM:SS, matching the backend's validated timestamp format.
    pub timestamp: String,
    pub source: WireAudioSource,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WireTranscript {
    pub duration_seconds: u64,
    pub segments: Vec<WireTranscriptSegment>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct WireCandidateContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume: Option<String>,
    #[serde(default)]
    pub projects: Vec<String>,
}

/// One interviewer question + candidate answer. Matches
/// `app/schemas/interview.py::QuestionAnswer`.
#[derive(Debug, Clone, Serialize)]
pub struct WireQuestionAnswer {
    pub question_id: String,
    pub question: String,
    pub candidate_answer: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct InterviewAnalysisRequest {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub company: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate_context: Option<WireCandidateContext>,
    pub transcript: WireTranscript,
    pub question_answers: Vec<WireQuestionAnswer>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct QuestionAnalysis {
    pub question_id: String,
    pub question: String,
    pub candidate_answer: String,
    pub assessment: String,
    pub score: i32,
    pub strengths: Vec<String>,
    pub issues: Vec<String>,
    pub improved_answer: String,
    pub failed: bool,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OverallInterviewAnalysis {
    pub session_id: String,
    pub status: String,
    pub overall_score: i32,
    pub technical_score: i32,
    pub communication_score: i32,
    pub practical_experience_score: i32,
    pub confidence_score: i32,
    pub summary: String,
    pub strengths: Vec<String>,
    pub weaknesses: Vec<String>,
    pub recommendations: Vec<String>,
    pub questions: Vec<QuestionAnalysis>,
    pub disclaimer: String,
    pub message: String,
}

/// One `data:` payload from the SSE stream — see
/// `apps/backend/app/services/analysis_service.py::AnalysisProgressEvent`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AnalysisProgressEvent {
    pub stage: String,
    pub detail: String,
    #[serde(default)]
    pub question_analysis: Option<QuestionAnalysis>,
    #[serde(default)]
    pub result: Option<OverallInterviewAnalysis>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ErrorDetail {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ErrorResponse {
    pub error: ErrorDetail,
}

/// Wire types for the lightweight `POST /api/v1/ask` (and `/ask/stream`)
/// endpoint used by Interview Mode — matches `apps/backend/app/schemas/ask.py`.
/// Deliberately much smaller than the full analysis request: one question,
/// optional free-text candidate context (no transcript, no question
/// history, no rubric).
///
/// One completed exchange earlier in the current Interview Mode session.
/// Replayed to the model so follow-ups ("why did you choose that?") resolve
/// against what was already discussed.
#[derive(Debug, Clone, Serialize)]
pub struct ConversationTurn {
    pub question: String,
    pub answer: String,
}

/// Lightweight, persisted-across-the-whole-session conversation state — the
/// thing that survives even after `conversation_history` has been trimmed to
/// its last few turns (see `interview_mode::commands::MAX_HISTORY_TURNS`).
/// Raw turn replay is deliberately bounded to keep prompt size/latency in
/// check; this small struct is the long-range memory that keeps a long
/// interview coherent without re-sending the whole transcript. Updated
/// asynchronously after each answer (see
/// `personal::DirectLlmClient::update_conversation_state`) so maintaining it
/// never adds latency to the answer the user is waiting on.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ConversationStateSnapshot {
    /// What specific aspect is currently being discussed — e.g. "tech
    /// stack", "role and responsibilities", "challenges faced" — as opposed
    /// to *which* project/company that aspect belongs to (see
    /// `current_entity`). `None` once the conversation moves back to
    /// something generic/topic-establishing.
    pub current_topic: Option<String>,
    /// The specific named project/company/system currently being discussed
    /// (e.g. "Security Co-pilot project"). This is what short follow-ups
    /// like "tech stack?" or "what was your role?" implicitly refer back to.
    pub current_entity: Option<String>,
    /// Distinct entities established earlier in the session, most-recent
    /// first — used so a topic switch ("tell me about another project") can
    /// point the model at something not already covered, and so a much
    /// later follow-up can still be resolved even after it has fallen out of
    /// the replayed history window.
    pub referenced_entities: Vec<String>,
}

/// Every context field here is optional and purely additive — the backend
/// answers the question with or without any of them (see
/// `apps/backend/app/services/ask_service.py`).
#[derive(Debug, Clone, Serialize)]
pub struct AskRequest {
    pub question: String,
    /// Prior turns of the current Interview Mode session, oldest first,
    /// excluding the question being asked now. Empty for the first question.
    pub conversation_history: Vec<ConversationTurn>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate_context: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub company: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_description: Option<String>,
    /// Free-form context the user typed/uploaded themselves in the Context
    /// popover's "Additional Context" section — anything not covered by the
    /// resume/job-description fields (company details, specific asks, etc.).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_context: Option<String>,
    /// "brief" | "default" | "detailed" — validated backend-side.
    pub answer_length: String,
    /// "natural" | "technical" | "concise" — validated backend-side.
    pub response_style: String,
    /// "simple" | "professional" | "advanced" — validated backend-side.
    pub english_level: String,
    /// "natural" | "conversational" | "formal" — validated backend-side.
    pub humanization: String,
    /// "openai" | "anthropic" | "gemini" — the header dropdown's chosen model provider.
    /// `None` keeps the server-configured LLM_PROVIDER default (see
    /// apps/backend/app/schemas/ask.py's AskRequest.llm_provider).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm_provider: Option<String>,
    /// Long-range conversation memory (see `ConversationStateSnapshot`) —
    /// independent of, and not trimmed alongside, `conversation_history`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_state: Option<ConversationStateSnapshot>,
    /// `Some` when this question comes from a Meeting Mode session — the AI
    /// then answers as the user taking part in a meeting (see
    /// `personal::prompts::meeting`) instead of as an interview candidate,
    /// and the interview-only fields above are all left `None`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meeting: Option<MeetingContext>,
    /// The user's own standing instructions for how answers should be
    /// written (the Context panel's "Custom instructions" field) — applies in
    /// both modes and outranks the default length/style guidance.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_instructions: Option<String>,
    /// "Deep Answer": route this question to the deep-reasoning model (see
    /// `personal::client::DEEP_MODEL`) instead of the fast default. Local
    /// routing only — never sent to the provider as-is.
    #[serde(skip)]
    pub deep: bool,
    /// Screenshots the user captured for this question (base64 PNGs, in
    /// order) — sent as images on the question's message.
    #[serde(skip)]
    pub images: Vec<String>,
    /// The question is a speaker-labeled stretch of conversation ("Them:" /
    /// "You:" lines) because the user's microphone is on — see
    /// `prompts::ask::build_user_prompt`.
    #[serde(skip)]
    pub speaker_labeled: bool,
    /// Assistant Mode (`None` in Interview/Meeting Mode): the user's own
    /// general-purpose assistant — see `prompts::assistant`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assistant: Option<AssistantContext>,
}

/// What the user shared with Assistant Mode: the full text of the files and
/// notes from its Context panel.
#[derive(Debug, Clone, Default, Serialize)]
pub struct AssistantContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// `Some` for a user-created custom mode, which runs on Assistant Mode's
    /// pipeline but with the user's own role in place of the assistant
    /// persona — see `prompts::assistant::custom_system_prompt`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom: Option<CustomModeContext>,
}

/// A custom mode the user created: its name and how the AI should act in it.
#[derive(Debug, Clone, Default, Serialize)]
pub struct CustomModeContext {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
}

/// Everything the user gave Meeting Mode about the meeting: the typed
/// purpose/participants from the Start popover, plus the full text of any
/// agenda/documents/knowledge-base/previous-notes uploads.
#[derive(Debug, Clone, Default, Serialize)]
pub struct MeetingContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topic: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub participants: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agenda: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documents: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub knowledge_base: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AskResponse {
    pub answer: String,
    pub latency_ms: f64,
}

/// Wire types for `POST /api/v1/setup/analyze` — matches
/// `apps/backend/app/schemas/setup_analysis.py`. Runs on the New Interview
/// setup page, before any interview session exists.
#[derive(Debug, Clone, Serialize, Default)]
pub struct SetupAnalysisRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_description_text: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default, PartialEq)]
pub struct SetupAnalysisResponse {
    #[serde(default)]
    pub job_title: Option<String>,
    #[serde(default)]
    pub company: Option<String>,
    #[serde(default)]
    pub seniority: Option<String>,
    #[serde(default)]
    pub employment_type: Option<String>,
    #[serde(default)]
    pub key_responsibilities: Vec<String>,
    #[serde(default)]
    pub required_skills: Vec<String>,
    #[serde(default)]
    pub technologies: Vec<String>,
    #[serde(default)]
    pub focus_areas: Vec<String>,
    #[serde(default)]
    pub candidate_highlights: Vec<String>,
}

/// Wire types for Notes Mode — matches `apps/backend/app/schemas/notes.py`.
#[derive(Debug, Clone, Serialize)]
pub struct NotesSummaryRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub body: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct NoteSummary {
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub tasks: Vec<String>,
    #[serde(default)]
    pub decisions: Vec<String>,
    #[serde(default)]
    pub key_points: Vec<String>,
    #[serde(default)]
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NoteContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub body: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NotesAskRequest {
    pub question: String,
    pub notes: Vec<NoteContext>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct NotesAskResponse {
    pub answer: String,
    pub latency_ms: f64,
}
