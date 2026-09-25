//! Turns an image the user attached as context (a pasted screenshot, a photo
//! of a slide, a chart) into plain text once, at attach time — so the rest
//! of the pipeline (`documents::latest_ready_text` → Ask AI's background
//! message) keeps treating every context document as text, and the image
//! isn't re-sent to a vision model on every single question.

use super::ChatMessage;

pub const MAX_TOKENS: u32 = 1500;
pub const TEMPERATURE: f32 = 0.0;

const SYSTEM_PROMPT: &str = "You convert an image into faithful plain text so it can be used later as background context. You are not answering anything about it — only transcribing and describing what is actually in it.

- Transcribe ALL readable text exactly as written, in reading order: headings, bullet points, labels, table cells, code, chat messages, numbers. Keep line breaks and list structure.
- Render tables as simple Markdown tables. Keep code in fenced code blocks.
- For charts, diagrams, or UI with little text, briefly describe what they show, including every value, label, trend, and connection you can actually read.
- Never invent, guess, or summarize away text that is present. If part of the image is unreadable, say \"[unreadable]\" there.
- Output only the transcription/description, with no preamble or commentary.";

pub fn build_messages(image_png_base64: String) -> Vec<ChatMessage> {
    vec![
        ChatMessage::system(SYSTEM_PROMPT),
        ChatMessage::user_with_image("Transcribe this image.", image_png_base64),
    ]
}
