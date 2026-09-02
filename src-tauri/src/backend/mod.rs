//! Shared wire types for AI requests/responses, reused by
//! `crate::personal::DirectLlmClient` for Interview/Notes/Analysis/
//! Setup — this personal build has no HTTP backend client; every AI call
//! goes directly to the configured provider (OpenAI/Anthropic/Gemini). See
//! `crate::personal` for the actual request-building/provider-calling logic.

mod types;

pub use types::{
    AnalysisProgressEvent, AskRequest, AskResponse, ConversationTurn,
    InterviewAnalysisRequest, NoteContext,
    NoteSummary, NotesAskRequest, NotesAskResponse, NotesSummaryRequest, OverallInterviewAnalysis,
    QuestionAnalysis, SetupAnalysisRequest, SetupAnalysisResponse,
    WireAudioSource, WireCandidateContext, WireQuestionAnswer, WireTranscript,
    WireTranscriptSegment,
};
