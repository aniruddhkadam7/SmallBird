//! Assistant Mode: the user's own general-purpose assistant — everyday
//! questions, explaining what's on screen or in a file, troubleshooting,
//! deciding what to do next. Not an interview and not a meeting.
//!
//! Deliberately self-contained: `ask::build_messages`, `screen::build_messages`
//! and `ask::max_tokens_for_question` hand an assistant request straight to
//! this module, so none of the interview/meeting prompt machinery (candidate
//! persona, question-format and length classification, conversation-state
//! resolution) ever applies here — and nothing here can change how those
//! modes behave.

use crate::backend::{AskRequest, CustomModeContext};

use super::ChatMessage;

pub const SYSTEM_PROMPT: &str = "You are the user's personal assistant, running privately on their own computer. This is not an interview and not a meeting — the user is asking you for help with whatever they're doing.

HOW TO HELP

- Answer the user's question directly. Explain anything they give you or show you — text, files, screenshots, code, errors, documents, web pages — and help them understand what to do next.
- Use everything available: what's on their screen, the files and notes they've shared, and this conversation so far.
- Be direct and honest. Never agree just to please the user: if they're wrong, say so plainly and briefly explain why.
- Never invent facts, numbers, names, quotes, links, or sources. If you're not sure or don't know, say so, and say what would settle it.
- Be practical: when there's something to do, give the concrete next steps.
- Questions often arrive through speech-to-text and can be rough or cut off. Work out what the user most likely means; if it's genuinely ambiguous, answer the most likely reading and say in a few words what you assumed.

FORMATTING — like the best chat assistants (ChatGPT, Gemini): clean, well-structured, easy to scan

- Match the shape to the question. A quick question gets a quick answer: one to three sentences with the key fact in **bold** — no headings, no lists. Anything with several parts, steps, options or ideas gets structure.
- Structured answers: open with a one- or two-sentence direct answer (the takeaway first), then organize the rest under short `##` headings (`###` for sub-parts) — any answer longer than about four sentences gets headings, e.g. \"## Why\", \"## How to do it\", \"## Options\", \"## Things to watch out for\". A table or list still sits under a heading.
- Numbered lists for steps and sequences; bullet lists for options, features, pros/cons and key points. Keep each item to one or two lines, and start it with a **bold lead phrase** when items have names.
- Use a Markdown table when comparing two or more things across the same attributes (plans, tools, options, specs) — keep it to a few columns.
- Code, commands and config go in fenced code blocks with the language (```bash, ```python …); file names, settings, keys and short commands inline in `backticks`.
- **Bold** the few words that matter most — not whole sentences. Short paragraphs (one to three sentences), with a blank line between blocks.
- When there's a clear next action, end with a short **Next step:** line. No generic closing summary, no \"hope this helps\".
- No emojis unless the user uses them.

STYLE

- Concise and useful by default: only the detail that actually helps. Go longer only when the user asks for more detail or the task genuinely needs it (step-by-step instructions, code, a full explanation they asked for).
- Plain, clear language.
- Talk to the user as \"you\". You are their assistant — not them, and not speaking on their behalf to anyone else.
- No filler, no flattery, no restating the question.";

/// A custom mode's system prompt: the user's own role for the mode up
/// front, then the same honesty and formatting ground rules as Assistant
/// Mode — softened to defaults, since the user's role may ask for something
/// else (one-line replies, speaking as them, another language).
pub fn custom_system_prompt(custom: &CustomModeContext) -> String {
    let name = custom.name.trim();
    let name = if name.is_empty() { "Custom" } else { name };
    let role = custom
        .role
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("Help the user with whatever they need in \"{name}\"."));
    format!(
        "You are running privately on the user's own computer, in a mode they set up themselves called \"{name}\".

YOUR ROLE AND HOW TO ACT — written by the user. It defines who you are, who you speak as, and how you behave in this mode. Follow it closely; where anything below conflicts with it, it wins:
{role}

WHAT YOU'LL RECEIVE

- Questions are typed by the user, or come from live speech-to-text of their microphone and/or audio playing on their computer (a call, a video, other people). Speech-to-text can be rough or cut off — work out what was most likely meant.
- When lines are labeled \"Them:\" / \"You:\", \"Them\" is the audio playing on the computer (other people) and \"You\" is the user. Don't write the labels in your answer.
- You may also get screenshots of the user's screen — use what's on them.

GROUND RULES

- Use the user's standing instructions and the files/notes they shared for this mode whenever they're relevant.
- Never invent facts, numbers, names, quotes, links, or sources. If something isn't known, say so plainly.
- The useful part first. No filler, no flattery, no restating the question.

FORMATTING — defaults, unless your role or the user's instructions say otherwise

- A quick question gets a quick answer: one to three sentences, key fact in **bold**.
- Longer answers use clean Markdown: short `##` headings, numbered lists for steps, bullets for options and key points, a table when comparing things, fenced code blocks for code.
- No emojis unless the user uses them."
    )
}

fn system_prompt(request: &AskRequest) -> String {
    match request.assistant.as_ref().and_then(|a| a.custom.as_ref()) {
        Some(custom) => custom_system_prompt(custom),
        None => SYSTEM_PROMPT.to_string(),
    }
}

/// What a screenshot-only question asks for.
pub const SCREEN_INSTRUCTION: &str = "Look at the attached screenshot(s) of my screen and help me with what's there. If there's a question, answer it. If there's an error, explain the cause and how to fix it. If it's code, explain or solve it. If it's a document, page, or message, give me the key points and anything I should act on. If it's unclear what I need, give the most useful short read of what's on screen.";

/// Ceiling on an answer's length: room for a structured answer (sections,
/// a table, a code fix), while the prompt keeps ordinary answers short.
pub const MAX_TOKENS: u32 = 2000;

/// Everyday help should be dependable, not creative.
pub const TEMPERATURE: f32 = 0.4;

/// The user's standing instructions and the files/notes they shared, sent as
/// one cacheable message ahead of the conversation.
fn background_message(request: &AskRequest) -> Option<String> {
    let instructions = request.custom_instructions.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let notes = request
        .assistant
        .as_ref()
        .and_then(|a| a.notes.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let mut parts = Vec::new();
    if let Some(instructions) = instructions {
        parts.push(format!(
            "MY STANDING INSTRUCTIONS FOR HOW YOU ANSWER (follow these; where they conflict with the default style, they win):\n{instructions}"
        ));
    }
    if let Some(notes) = notes {
        parts.push(format!(
            "FILES AND NOTES I'VE SHARED WITH YOU (use them when they're relevant; don't bring them up otherwise):\n{notes}"
        ));
    }
    (!parts.is_empty()).then(|| parts.join("\n\n---\n\n"))
}

/// The current request, framed by where it came from.
fn user_prompt(request: &AskRequest) -> String {
    let with_language = |prompt: String| format!("{prompt}\n\n{}", super::LANGUAGE_RULE);
    let screenshots_only = !request.images.is_empty() && request.question == super::screen::SCREEN_QUESTION_LABEL;
    if screenshots_only || request.question.trim().is_empty() {
        return with_language(SCREEN_INSTRUCTION.to_string());
    }
    let mut prompt = if request.speaker_labeled {
        format!(
            "What was said, line by line — \"Them:\" is audio playing on my computer (a video, a call, other people), \"You:\" is me speaking:\n{}\n\nHelp me with it: answer what I asked, or explain or respond to what was said if that's what I need. Don't write the labels in your answer.",
            request.question
        )
    } else {
        request.question.clone()
    };
    if !request.images.is_empty() {
        prompt.push_str(&format!(
            "\n\n(I've attached {} screenshot(s) of my screen, in the order taken — use them.)",
            request.images.len()
        ));
    }
    with_language(prompt)
}

pub fn build_messages(request: &AskRequest) -> Vec<ChatMessage> {
    let mut messages = vec![ChatMessage::system(system_prompt(request))];
    if let Some(background) = background_message(request) {
        messages.push(ChatMessage::cacheable_user(background));
        messages.push(ChatMessage::assistant(super::ask::BACKGROUND_ACK));
    }
    for turn in &request.conversation_history {
        messages.push(ChatMessage::user(turn.question.clone()));
        messages.push(ChatMessage::assistant(turn.answer.clone()));
    }
    let prompt = user_prompt(request);
    if request.images.is_empty() {
        messages.push(ChatMessage::user(prompt));
    } else {
        messages.push(ChatMessage::user_with_images(prompt, request.images.clone()));
    }
    messages
}

/// The Analyze-screen path (one fresh screenshot, no typed question).
pub fn build_screen_messages(request: &AskRequest, image_png_base64: &str) -> Vec<ChatMessage> {
    let mut messages = vec![ChatMessage::system(system_prompt(request))];
    if let Some(background) = background_message(request) {
        messages.push(ChatMessage::cacheable_user(background));
        messages.push(ChatMessage::assistant(super::ask::BACKGROUND_ACK));
    }
    for turn in &request.conversation_history {
        messages.push(ChatMessage::user(turn.question.clone()));
        messages.push(ChatMessage::assistant(turn.answer.clone()));
    }
    let instruction = format!("{SCREEN_INSTRUCTION}\n\n{}", super::LANGUAGE_RULE);
    messages.push(ChatMessage::user_with_image(instruction, image_png_base64));
    messages
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::{AssistantContext, ConversationTurn, CustomModeContext};

    fn request(question: &str) -> AskRequest {
        AskRequest {
            question: question.to_string(),
            conversation_history: vec![],
            candidate_context: None,
            role: None,
            company: None,
            job_description: None,
            additional_context: None,
            answer_length: "default".to_string(),
            response_style: "natural".to_string(),
            english_level: "simple".to_string(),
            humanization: "natural".to_string(),
            llm_provider: None,
            conversation_state: None,
            meeting: None,
            custom_instructions: None,
            deep: false,
            images: Vec::new(),
            speaker_labeled: false,
            assistant: Some(AssistantContext::default()),
        }
    }

    #[test]
    fn uses_its_own_system_prompt_and_passes_the_question_through() {
        let messages = build_messages(&request("How do I undo my last git commit?"));
        assert_eq!(messages[0].content, SYSTEM_PROMPT);
        let last = messages.last().unwrap();
        assert!(last.content.starts_with("How do I undo my last git commit?"));
        assert!(!messages.iter().any(|m| m.content.contains("interviewer") || m.content.contains("candidate")));
    }

    #[test]
    fn includes_instructions_notes_and_history() {
        let mut req = request("And the second step?");
        req.custom_instructions = Some("Answer in Hindi".into());
        req.assistant = Some(AssistantContext { notes: Some("My router is a TP-Link Archer C6".into()), custom: None });
        req.conversation_history = vec![ConversationTurn { question: "Wifi keeps dropping".into(), answer: "1. Restart the router…".into() }];
        let messages = build_messages(&req);
        assert!(messages[1].content.contains("Answer in Hindi"));
        assert!(messages[1].content.contains("TP-Link Archer C6"));
        assert_eq!(messages[3].content, "Wifi keeps dropping");
        assert!(messages.last().unwrap().content.starts_with("And the second step?"));
    }

    #[test]
    fn meeting_prompt_allows_headings_for_long_answers_only() {
        // Interview answers are spoken, so they get no headings (see
        // ask::tests::interview_answers_never_announce_their_structure).
        let prompt = super::super::meeting::SYSTEM_PROMPT;
        assert!(prompt.contains("LONG, MULTI-PART ANSWERS ONLY"));
        assert!(prompt.contains("Never add headings or tables to a short"));
    }

    #[test]
    fn asks_for_chat_style_formatting() {
        let messages = build_messages(&request("Compare AWS and Azure for a small startup"));
        assert!(messages[0].content.contains("`##` headings"));
        assert!(messages[0].content.contains("Markdown table"));
    }

    #[test]
    fn answers_follow_the_question_language() {
        let last = build_messages(&request("DNS क्या है?")).last().unwrap().content.clone();
        assert!(last.starts_with("DNS क्या है?"));
        assert!(last.contains("Devanagari"));
    }

    #[test]
    fn custom_mode_uses_the_users_role_as_its_system_prompt() {
        let mut req = request("What's our refund window?");
        req.custom_instructions = Some("Two sentences max".into());
        req.assistant = Some(AssistantContext {
            notes: Some("Refunds within 30 days".into()),
            custom: Some(CustomModeContext {
                name: "Support calls".into(),
                role: Some("Act as me, a support agent for Acme. Reply in the first person.".into()),
            }),
        });
        let messages = build_messages(&req);
        assert!(messages[0].content.contains("\"Support calls\""));
        assert!(messages[0].content.contains("Act as me, a support agent for Acme."));
        assert!(!messages[0].content.contains("You are the user's personal assistant"));
        assert!(messages[1].content.contains("Two sentences max"));
        assert!(messages[1].content.contains("Refunds within 30 days"));
    }

    #[test]
    fn custom_mode_without_a_role_still_names_the_mode() {
        let custom = CustomModeContext { name: "Study buddy".into(), role: None };
        assert!(custom_system_prompt(&custom).contains("Help the user with whatever they need in \"Study buddy\"."));
    }

    #[test]
    fn screenshot_only_question_asks_about_the_screen() {
        let mut req = request(super::super::screen::SCREEN_QUESTION_LABEL);
        req.images = vec!["iVBOR".into()];
        assert!(build_messages(&req).last().unwrap().content.starts_with(SCREEN_INSTRUCTION));
    }
}
