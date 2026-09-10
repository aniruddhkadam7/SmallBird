//! Maintains `ConversationStateSnapshot` across a whole interview session.
//!
//! Deliberately a *separate*, small, non-streaming call made after an answer
//! has already been streamed back to the user (see
//! `personal::DirectLlmClient::update_conversation_state` and where it's
//! spawned in `interview_mode::commands::ask_interview_question`) — it must
//! never sit in the critical path of the answer the user is waiting on.
//! Extracting "what project/topic is this?" from free-form Q&A text isn't
//! something a cheap regex can do reliably (project names are arbitrary),
//! so this uses the model itself, but kept to a tiny prompt and a tiny
//! output budget since it runs once per turn in the background.

use crate::backend::ConversationStateSnapshot;
use super::{extract_json_object, ChatMessage};

pub const MAX_TOKENS: u32 = 80;

const SYSTEM_PROMPT: &str = "You track lightweight conversation state for a live job-interview session, so short follow-up questions later can be resolved correctly.

Given the prior state, the interviewer's latest question, and the candidate's answer, output ONLY a compact JSON object, no prose, no markdown fences:

{\"topic\": string or null, \"entity\": string or null}

\"entity\" is the specific named project, system, or company the answer was actually about (e.g. \"Security Co-pilot project\", \"Acme Corp\") — null if the answer was generic/not about one specific thing.
\"topic\" is the specific aspect currently being discussed (e.g. \"tech stack\", \"role and responsibilities\", \"challenges faced\", \"career background\") — null if there isn't a clear specific aspect.

If the answer named a NEW project/entity different from the prior state's entity, report that new one. If the answer continued discussing the same entity as before, report that same one again. If the exchange was a topic switch away from a specific entity into something generic (e.g. \"tell me about yourself\"), set entity to null.";

fn build_prior_state_line(prior: &ConversationStateSnapshot) -> String {
    format!(
        "Prior state: topic={}, entity={}",
        prior.current_topic.as_deref().unwrap_or("null"),
        prior.current_entity.as_deref().unwrap_or("null"),
    )
}

pub fn build_messages(prior: &ConversationStateSnapshot, question: &str, answer: &str) -> Vec<ChatMessage> {
    vec![
        ChatMessage::system(SYSTEM_PROMPT),
        ChatMessage::user(format!(
            "{}\n\nInterviewer's latest question: {question}\n\nCandidate's answer: {answer}\n\nOutput the JSON object now.",
            build_prior_state_line(prior)
        )),
    ]
}

#[derive(serde::Deserialize)]
struct TrackerOutput {
    #[serde(default)]
    topic: Option<String>,
    #[serde(default)]
    entity: Option<String>,
}

/// Merges the tracker's parsed output into the prior state: when the entity
/// changes to a new, non-empty value, the old one (if any, and not already
/// recorded) is pushed onto `referenced_entities` so a later topic switch or
/// out-of-window follow-up can still find it.
pub fn merge_state(prior: &ConversationStateSnapshot, parsed_topic: Option<String>, parsed_entity: Option<String>) -> ConversationStateSnapshot {
    let mut referenced_entities = prior.referenced_entities.clone();

    let current_entity = match (&prior.current_entity, &parsed_entity) {
        (Some(old), Some(new)) if old != new => {
            if !referenced_entities.iter().any(|e| e == old) {
                referenced_entities.insert(0, old.clone());
            }
            Some(new.clone())
        }
        (None, Some(new)) => Some(new.clone()),
        (old, None) => old.clone(),
        (_, new) => new.clone(),
    };

    ConversationStateSnapshot {
        current_topic: parsed_topic.or_else(|| prior.current_topic.clone()),
        current_entity,
        referenced_entities,
    }
}

/// Parses the raw model response and merges it into `prior`. Returns `None`
/// on any parse failure — the caller should then simply keep using `prior`
/// unchanged; a failed background state update must never surface as a
/// user-visible error.
pub fn parse_response(prior: &ConversationStateSnapshot, raw: &str) -> Option<ConversationStateSnapshot> {
    let json_text = extract_json_object(raw).ok()?;
    let parsed: TrackerOutput = serde_json::from_str(&json_text).ok()?;
    Some(merge_state(prior, parsed.topic, parsed.entity))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(topic: Option<&str>, entity: Option<&str>, referenced: &[&str]) -> ConversationStateSnapshot {
        ConversationStateSnapshot {
            current_topic: topic.map(str::to_string),
            current_entity: entity.map(str::to_string),
            referenced_entities: referenced.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn parses_plain_json_response() {
        let prior = ConversationStateSnapshot::default();
        let result = parse_response(&prior, r#"{"topic": "tech stack", "entity": "Security Co-pilot project"}"#).unwrap();
        assert_eq!(result.current_topic.as_deref(), Some("tech stack"));
        assert_eq!(result.current_entity.as_deref(), Some("Security Co-pilot project"));
    }

    #[test]
    fn parses_response_wrapped_in_code_fence() {
        let prior = ConversationStateSnapshot::default();
        let raw = "```json\n{\"topic\": \"role\", \"entity\": \"Project A\"}\n```";
        let result = parse_response(&prior, raw).unwrap();
        assert_eq!(result.current_entity.as_deref(), Some("Project A"));
    }

    #[test]
    fn malformed_response_returns_none() {
        let prior = ConversationStateSnapshot::default();
        assert!(parse_response(&prior, "not json at all").is_none());
    }

    #[test]
    fn new_entity_pushes_old_one_into_referenced_entities() {
        let prior = snapshot(Some("tech stack"), Some("Project A"), &[]);
        let merged = merge_state(&prior, Some("role".to_string()), Some("Project B".to_string()));
        assert_eq!(merged.current_entity.as_deref(), Some("Project B"));
        assert_eq!(merged.referenced_entities, vec!["Project A".to_string()]);
    }

    #[test]
    fn same_entity_continuing_does_not_duplicate_referenced_entities() {
        let prior = snapshot(Some("tech stack"), Some("Project A"), &[]);
        let merged = merge_state(&prior, Some("challenges".to_string()), Some("Project A".to_string()));
        assert_eq!(merged.current_entity.as_deref(), Some("Project A"));
        assert!(merged.referenced_entities.is_empty());
    }

    #[test]
    fn generic_exchange_does_not_lose_the_established_entity() {
        // A single generic/off-topic exchange (small talk, a process
        // question) shouldn't wipe out which project was active — that
        // would break resolving the *next* follow-up back to it. The entity
        // only actually changes via an explicit new entity or a detected
        // topic switch (handled by `conversation::resolution_block`, which
        // tells the model to name a genuinely different project).
        let prior = snapshot(Some("tech stack"), Some("Project A"), &[]);
        let merged = merge_state(&prior, Some("career background".to_string()), None);
        assert_eq!(merged.current_entity.as_deref(), Some("Project A"));
    }

    #[test]
    fn missing_topic_keeps_prior_topic() {
        let prior = snapshot(Some("tech stack"), Some("Project A"), &[]);
        let merged = merge_state(&prior, None, Some("Project A".to_string()));
        assert_eq!(merged.current_topic.as_deref(), Some("tech stack"));
    }
}
