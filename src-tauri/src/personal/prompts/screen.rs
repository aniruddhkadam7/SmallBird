//! "Analyze Screen" — a one-shot vision question: a screenshot of the
//! candidate's own screen (typically showing a coding problem, a
//! system-design/whiteboard diagram, or written interview questions the
//! interviewer shared) is sent to the LLM as an image alongside a fixed
//! instruction, reusing the same system prompt, live-candidate voice, and
//! FORMAT rules as the regular Ask AI flow (see `ask::SYSTEM_PROMPT`), plus
//! the same cached-background priming (see `ask::build_background_message`)
//! so this doesn't reset the session's prompt cache.

use crate::backend::AskRequest;
use super::{ask, ChatMessage};

/// Generous enough for a full FORMAT-7 code answer (see `ask::LengthTarget`'s
/// "code" tier) with some headroom — screen content isn't classified into a
/// length tier the way a spoken question is, so this picks a single budget
/// that comfortably covers the longest realistic case (a coding problem)
/// without being so large it slows down a short one.
pub const MAX_TOKENS: u32 = 700;

const INSTRUCTION: &str = "Look at the attached screenshot of what's currently on my screen during this interview — it might show a coding problem, a system-design/whiteboard diagram, written interview questions, or something else relevant to the interview. Identify what it is and answer/solve it directly, in the same terse cheat-sheet-notes STYLE and FORMAT rules as any other question in this interview. If it's a coding problem, write real working code per FORMAT 7. If nothing on screen looks like an interview question or problem (e.g. it's an unrelated app), say briefly what you actually see instead of forcing an answer.";

pub fn build_messages(request: &AskRequest, image_png_base64: String) -> Vec<ChatMessage> {
    let mut messages = vec![ChatMessage::system(ask::SYSTEM_PROMPT)];

    if let Some(background) = ask::build_background_message(request) {
        messages.push(ChatMessage::cacheable_user(background));
        messages.push(ChatMessage::assistant(ask::BACKGROUND_ACK));
    }

    for turn in &request.conversation_history {
        messages.push(ChatMessage::user(turn.question.clone()));
        messages.push(ChatMessage::assistant(turn.answer.clone()));
    }

    messages.push(ChatMessage::user_with_image(INSTRUCTION, image_png_base64));
    messages
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_request() -> AskRequest {
        AskRequest {
            question: "What's on my screen?".to_string(),
            conversation_history: vec![],
            candidate_context: None,
            role: None,
            job_description: None,
            additional_context: None,
            answer_length: "default".to_string(),
            response_style: "natural".to_string(),
            english_level: "simple".to_string(),
            humanization: "natural".to_string(),
            llm_provider: None,
        }
    }

    #[test]
    fn attaches_image_to_final_message_only() {
        let messages = build_messages(&base_request(), "fake-base64".to_string());
        assert_eq!(messages.len(), 2); // system, user(instruction+image)
        assert!(messages[0].image_png_base64.is_none());
        let last = messages.last().unwrap();
        assert_eq!(last.role, "user");
        assert_eq!(last.image_png_base64.as_deref(), Some("fake-base64"));
        assert!(last.content.contains("screenshot"));
    }

    #[test]
    fn includes_cached_background_pair_when_context_present() {
        let mut req = base_request();
        req.role = Some("Backend Engineer".to_string());
        let messages = build_messages(&req, "img".to_string());
        // system, cacheable user(background), assistant(ack), user(instruction+image)
        assert_eq!(messages.len(), 4);
        assert!(messages[1].cacheable);
        assert!(messages[1].content.contains("Backend Engineer"));
        assert_eq!(messages[2].role, "assistant");
        assert!(messages[3].image_png_base64.is_some());
    }
}
