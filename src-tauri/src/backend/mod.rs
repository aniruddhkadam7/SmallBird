//! Shared wire types for AI requests/responses, reused by
//! `crate::personal::DirectLlmClient` for Interview/Meeting/Notes/Analysis/
//! Setup — this personal build has no HTTP backend client; every AI call
//! goes directly to the configured provider (OpenAI/Anthropic/Gemini). See
//! `crate::personal` for the actual request-building/provider-calling logic.

mod types;

pub use types::{
    AnalysisProgressEvent, AskRequest, AskResponse, ConversationTurn,
    InterviewAnalysisRequest, MeetingAskRequest, MeetingAskResponse, MeetingConversationTurn,
    MeetingSummary, MeetingSummaryRequest, MeetingTurnIn, NoteContext,
    NoteSummary, NotesAskRequest, NotesAskResponse, NotesSummaryRequest, OverallInterviewAnalysis,
    QuestionAnalysis, SetupAnalysisRequest, SetupAnalysisResponse,
    WireAudioSource, WireCandidateContext, WireQuestionAnswer, WireTranscript,
    WireTranscriptSegment,
};
