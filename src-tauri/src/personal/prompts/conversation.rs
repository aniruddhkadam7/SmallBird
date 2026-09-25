//! Conversation-flow resolution for Interview Mode's "ask" pipeline.
//!
//! The bug this exists to fix: every question used to be answered as if it
//! were asked in isolation. The system prompt's "FOLLOW-UP QUESTIONS"
//! section asked the model to infer continuity purely from the replayed
//! message history, and in practice that was not reliable enough for short,
//! bare-noun follow-ups ("tech stack?", "your role?") which don't look like
//! the "why did you choose that?" style example the prompt gave — the model
//! would fall back to a generic, context-free answer instead.
//!
//! This module adds a deterministic (no extra LLM round-trip, so it costs no
//! latency) classification pass over the current question, and turns that
//! classification plus the persisted `ConversationStateSnapshot` into an
//! explicit instruction block injected into the per-question prompt. The
//! model still does the actual resolution (it's the only thing that can read
//! free-form CV/JD text and the full history and know which project "that"
//! means) — this module's job is to stop it from ever treating a
//! context-dependent question as a fresh, standalone one.

use crate::backend::{ConversationStateSnapshot, ConversationTurn};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuestionIntent {
    /// Self-contained, or the first question of the session — answer it on
    /// its own terms, same as today.
    New,
    /// Refers back to what was just discussed without naming a new subject
    /// ("tech stack?", "and the challenges?").
    FollowUp,
    /// Almost entirely a bare pronoun/short generic noun phrase with no
    /// independent subject ("that", "this", "it", "why that", "your role?").
    /// Handled like `FollowUp` but flagged separately since it's the
    /// clearest signal something upstream must resolve.
    Reference,
    /// The interviewer is pointing out the previous answer(s) didn't address
    /// what they actually wanted ("no, I mean...", "I asked for your
    /// project", "that's not what I asked").
    Correction,
    /// The interviewer wants a clarification of something ambiguous in the
    /// previous answer ("what do you mean by that?", "can you clarify?").
    Clarification,
    /// The interviewer wants to move to a different project/topic than the
    /// one just discussed ("tell me about another project", "let's talk
    /// about something else").
    TopicSwitch,
    /// Wants a comparison involving the current topic ("how does that
    /// compare to X?", "X vs Y").
    Comparison,
    /// Wants more depth on the exact same topic ("tell me more", "go
    /// deeper", "elaborate on that").
    Deepening,
}

const CORRECTION_MARKERS: &[&str] = &[
    "no i mean", "no, i mean", "i mean the", "i meant", "not that", "not what i asked",
    "that's not what i asked", "thats not what i asked", "i asked for", "i asked about",
    "i was asking about", "actually i meant", "actually, i meant", "i didn't ask", "i didnt ask",
    // Spoken pushback, as it actually comes through speech-to-text in a
    // meeting ("you are not understanding i am saying those 11 points…").
    "not understanding", "not understand", "don't understand", "dont understand", "not getting it",
    "you are not getting", "you're not getting", "youre not getting", "i am saying", "i'm saying",
    "im saying", "what i am asking", "what i'm asking", "what im asking", "that's wrong", "thats wrong",
    "that is wrong", "not correct", "that's not it", "thats not it", "not what i mean",
];
const TOPIC_SWITCH_MARKERS: &[&str] = &[
    "another project", "a different project", "different project", "other project",
    "something else", "switch to", "moving on", "next question", "let's talk about",
    "lets talk about", "let's discuss", "lets discuss", "a different one", "any other project",
];
const COMPARISON_MARKERS: &[&str] = &["compare", "versus", " vs ", "vs.", "difference between", "which is better", "how does that compare"];
const DEEPENING_MARKERS: &[&str] = &["tell me more", "go deeper", "elaborate", "expand on that", "more detail", "dive deeper", "can you expand"];
const CLARIFICATION_MARKERS: &[&str] = &["what do you mean", "can you clarify", "could you clarify", "clarify that", "what does that mean"];

/// Bare pronouns/anaphora that, as the main subject of a short question,
/// mean the question cannot be answered without resolving what they point
/// to ("why did you choose that?", "how did you build it?").
const PRONOUN_MARKERS: &[&str] = &[" that", " this", " it?", " it.", " it,", " them", " those", "that?", "this?"];

/// Short, generic noun phrases that name an *aspect* rather than a subject —
/// answerable only in reference to whatever entity is currently active
/// ("tech stack?", "your role?", "the challenges?").
const BARE_ASPECT_MARKERS: &[&str] = &[
    "tech stack", "the stack", "your role", "the role", "your part", "the challenges",
    "challenges faced", "any challenges", "the implementation", "your implementation",
    "the approach", "your approach", "the outcome", "the result", "the timeline",
    "how long did it take", "how long", "the architecture",
];

fn contains_any(lowered: &str, markers: &[&str]) -> bool {
    markers.iter().any(|m| lowered.contains(m))
}

/// A question is "bare" when it's short AND matches one of the known
/// aspect-only phrasings ("tech stack", "your role", ...) that name a
/// property rather than a subject. Deliberately does not treat short
/// questions in general as follow-ups — "What's Docker?" or "Define REST"
/// are short but name their own subject, so they must stay `New`; only the
/// specific bare-aspect phrasings below are ambiguous without context.
fn is_bare_fragment(lowered: &str) -> bool {
    let word_count = lowered.split_whitespace().count();
    (word_count <= 5 && contains_any(lowered, BARE_ASPECT_MARKERS)) || contains_any(lowered, PRONOUN_MARKERS)
}

/// Classifies the current question's relationship to the conversation so
/// far. `has_history` short-circuits everything to `New` — there is nothing
/// to be a follow-up/correction/switch *of* on the first question of a
/// session.
pub fn classify_intent(question: &str, has_history: bool) -> QuestionIntent {
    if !has_history {
        return QuestionIntent::New;
    }
    let lowered = format!(" {} ", question.trim().to_lowercase());

    if contains_any(&lowered, CORRECTION_MARKERS) {
        return QuestionIntent::Correction;
    }
    if contains_any(&lowered, TOPIC_SWITCH_MARKERS) {
        return QuestionIntent::TopicSwitch;
    }
    if contains_any(&lowered, CLARIFICATION_MARKERS) {
        return QuestionIntent::Clarification;
    }
    if contains_any(&lowered, COMPARISON_MARKERS) {
        return QuestionIntent::Comparison;
    }
    if contains_any(&lowered, DEEPENING_MARKERS) {
        return QuestionIntent::Deepening;
    }
    if contains_any(&lowered, PRONOUN_MARKERS) {
        return QuestionIntent::Reference;
    }
    if is_bare_fragment(&lowered) {
        return QuestionIntent::FollowUp;
    }
    QuestionIntent::New
}

fn entity_label(state: Option<&ConversationStateSnapshot>) -> Option<String> {
    state.and_then(|s| s.current_entity.clone())
}

fn topic_label(state: Option<&ConversationStateSnapshot>) -> Option<String> {
    state.and_then(|s| s.current_topic.clone())
}

fn referenced_list(state: Option<&ConversationStateSnapshot>) -> String {
    match state {
        Some(s) if !s.referenced_entities.is_empty() => s.referenced_entities.join(", "),
        _ => "none established yet".to_string(),
    }
}

/// Builds the explicit resolution instruction injected into the per-question
/// prompt for anything that isn't a fresh, self-contained question. Returns
/// `None` for `QuestionIntent::New` — the existing prompt already handles a
/// standalone question correctly, so nothing extra is added.
pub fn resolution_block(intent: QuestionIntent, state: Option<&ConversationStateSnapshot>, prior_turn: Option<&ConversationTurn>) -> Option<String> {
    resolution_block_for(intent, state, prior_turn, false)
}

/// `resolution_block`, worded for the session's mode — in Meeting Mode the
/// other side is a meeting participant, not an interviewer, and there is no
/// "candidate" or candidate background to pick projects from.
pub fn resolution_block_for(
    intent: QuestionIntent,
    state: Option<&ConversationStateSnapshot>,
    prior_turn: Option<&ConversationTurn>,
    meeting: bool,
) -> Option<String> {
    let (speaker_label, speaker, background) = if meeting {
        ("Participant", "the other participant", "the meeting material")
    } else {
        ("Interviewer", "the interviewer", "the candidate's background")
    };
    let entity = entity_label(state);
    let topic = topic_label(state);
    let entity_or_fallback = entity.clone().unwrap_or_else(|| "the specific project/topic from the immediately preceding exchange".to_string());

    let prior_exchange = prior_turn
        .map(|t| format!("\n\nThe immediately preceding exchange was:\n{speaker_label}: {}\nYou: {}", t.question, truncate(&t.answer, 600)))
        .unwrap_or_default();

    let block = match intent {
        QuestionIntent::New => return None,
        QuestionIntent::FollowUp | QuestionIntent::Reference => format!(
            "CONVERSATION CONTEXT — this question is a FOLLOW-UP, not a fresh question. It is short and does not name its own subject, so it is asking about {entity_or_fallback}{topic_hint}. Do NOT answer with a generic/default version of this — resolve it specifically against the current topic/project and answer that.{prior_exchange}",
            topic_hint = topic.map(|t| format!(" (specifically: {t})")).unwrap_or_default(),
        ),
        QuestionIntent::Correction => format!(
            "CONVERSATION CONTEXT — CORRECTION: {speaker} is telling you that your previous answer did not address what they actually asked — it was wrong or missed the point. Do not repeat or lightly rephrase your previous answer, and do not reuse its list or its examples. Re-read this question and the conversation so far, work out precisely what they now want (they may name it directly), and give a genuinely different answer to that.{prior_exchange}"
        ),
        QuestionIntent::Clarification => format!(
            "CONVERSATION CONTEXT — CLARIFICATION REQUEST: {speaker} found your previous answer too vague or unclear. Be concrete this time — name the specific project/technology/term involved (currently: {entity_or_fallback}) rather than repeating a generic statement.{prior_exchange}"
        ),
        QuestionIntent::TopicSwitch => format!(
            "CONVERSATION CONTEXT — TOPIC SWITCH: {speaker} wants to move to a DIFFERENT project/topic than the one just discussed ({entity_or_fallback}). Pick a distinct one from {background} that is not one of these already-covered ones: {referenced}. Discuss that new one specifically for the rest of this answer and going forward.",
            referenced = referenced_list(state),
        ),
        QuestionIntent::Comparison => format!(
            "CONVERSATION CONTEXT — COMPARISON: {speaker} wants a comparison that involves the current topic ({entity_or_fallback}). Anchor one side of the comparison to that specific project/technology, not a generic one.{prior_exchange}"
        ),
        QuestionIntent::Deepening => format!(
            "CONVERSATION CONTEXT — DEEPENING: {speaker} wants more depth on the exact same thing just discussed ({entity_or_fallback}) — do not move to a new topic or re-summarize what was already said, go further into it.{prior_exchange}"
        ),
    };
    Some(block)
}

fn truncate(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        text.to_string()
    } else {
        let truncated: String = text.chars().take(max_chars).collect();
        format!("{truncated}...")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state_with(entity: Option<&str>, topic: Option<&str>, referenced: &[&str]) -> ConversationStateSnapshot {
        ConversationStateSnapshot {
            current_topic: topic.map(str::to_string),
            current_entity: entity.map(str::to_string),
            referenced_entities: referenced.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn first_question_is_always_new() {
        assert_eq!(classify_intent("tech stack?", false), QuestionIntent::New);
    }

    #[test]
    fn bare_tech_stack_after_history_is_followup() {
        assert_eq!(classify_intent("tech stack?", true), QuestionIntent::FollowUp);
        assert_eq!(classify_intent("Tech stack", true), QuestionIntent::FollowUp);
    }

    #[test]
    fn bare_role_question_is_followup() {
        assert_eq!(classify_intent("your role?", true), QuestionIntent::FollowUp);
        assert_eq!(classify_intent("What was your role?", true), QuestionIntent::FollowUp);
    }

    #[test]
    fn pronoun_question_is_reference() {
        assert_eq!(classify_intent("Why did you choose that?", true), QuestionIntent::Reference);
        assert_eq!(classify_intent("How did you implement it?", true), QuestionIntent::Reference);
    }

    #[test]
    fn explicit_correction_is_detected() {
        assert_eq!(classify_intent("No, I mean the Security Co-pilot project", true), QuestionIntent::Correction);
        assert_eq!(classify_intent("I asked for your project", true), QuestionIntent::Correction);
    }

    #[test]
    fn spoken_meeting_pushback_is_a_correction() {
        assert_eq!(
            classify_intent("you are not understanding i am saying those 11 points can we use repos to assess of scan of client", true),
            QuestionIntent::Correction
        );
        assert_eq!(classify_intent("no that's wrong", true), QuestionIntent::Correction);
    }

    #[test]
    fn topic_switch_is_detected() {
        assert_eq!(classify_intent("Okay, tell me about another project", true), QuestionIntent::TopicSwitch);
    }

    #[test]
    fn comparison_and_deepening_are_detected() {
        assert_eq!(classify_intent("How does that compare to Kafka?", true), QuestionIntent::Comparison);
        assert_eq!(classify_intent("Can you tell me more about that?", true), QuestionIntent::Deepening);
    }

    #[test]
    fn self_contained_new_question_is_not_reclassified() {
        assert_eq!(classify_intent("What is Kubernetes?", true), QuestionIntent::New);
        assert_eq!(classify_intent("Tell me about a time you resolved a conflict with a coworker", true), QuestionIntent::New);
    }

    #[test]
    fn new_intent_produces_no_resolution_block() {
        assert!(resolution_block(QuestionIntent::New, None, None).is_none());
    }

    #[test]
    fn followup_block_names_current_entity() {
        let state = state_with(Some("Security Co-pilot project"), Some("tech stack"), &[]);
        let block = resolution_block(QuestionIntent::FollowUp, Some(&state), None).unwrap();
        assert!(block.contains("Security Co-pilot project"));
        assert!(block.contains("FOLLOW-UP"));
    }

    #[test]
    fn followup_block_falls_back_without_state() {
        let block = resolution_block(QuestionIntent::FollowUp, None, None).unwrap();
        assert!(block.contains("immediately preceding exchange"));
    }

    #[test]
    fn topic_switch_block_lists_already_covered_entities() {
        let state = state_with(Some("Project A"), None, &["Project A"]);
        let block = resolution_block(QuestionIntent::TopicSwitch, Some(&state), None).unwrap();
        assert!(block.contains("Project A"));
        assert!(block.contains("TOPIC SWITCH"));
    }

    #[test]
    fn correction_block_mentions_not_repeating_previous_answer() {
        let block = resolution_block(QuestionIntent::Correction, None, None).unwrap();
        assert!(block.to_lowercase().contains("do not repeat"));
    }
}
