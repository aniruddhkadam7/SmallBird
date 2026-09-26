pub mod ask;
pub mod analysis;
pub mod conversation;
pub mod image_context;
/// Speech is transcribed as English, Hindi, or a mix (see stt/client.rs), in
/// every mode — answers follow the language each question was asked in.
pub const LANGUAGE_RULE: &str = "LANGUAGE (this overrides any rule above about writing in English): the conversation may be in English, Hindi, or a mix of both. Reply in the language the question was asked in — English if it was asked in English, Hindi in Devanagari script if it was asked in Hindi, and the same natural Hindi-English mix if that's how it was asked. Keep technical terms, product names and code in English, the way people actually say them.";

pub mod assistant;
pub mod meeting;
pub mod notes;
pub mod screen;
pub mod setup;
pub mod state_tracker;

/// One chat message, mirroring `apps/backend/app/services/llm/base.py`'s
/// `LLMMessage` — role is "system" | "user" | "assistant" throughout this
/// module (Anthropic/Gemini map "assistant" onto their own role name at the
/// provider layer, not here).
#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub role: &'static str,
    pub content: String,
    /// Marks this message as a stable, identical-every-call prefix worth an
    /// explicit cache breakpoint. Anthropic gets a `cache_control` block on
    /// it (see `providers::anthropic::split_system`); OpenAI has no manual
    /// knob but benefits anyway, since keeping this content in its own fixed
    /// message (rather than folded into the ever-changing per-question
    /// message) keeps the request's leading messages byte-identical across
    /// questions in the same session, which is what its automatic prefix
    /// caching keys on.
    pub cacheable: bool,
    /// Base64-encoded PNGs attached to this message, in order, for vision
    /// requests (screenshots the user captured from the overlay, an image
    /// attached as context — see `prompts::screen`/`prompts::image_context`).
    /// Empty for every ordinary text-only message.
    pub images: Vec<String>,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self { role: "system", content: content.into(), cacheable: false, images: Vec::new() }
    }
    pub fn user(content: impl Into<String>) -> Self {
        Self { role: "user", content: content.into(), cacheable: false, images: Vec::new() }
    }
    pub fn assistant(content: impl Into<String>) -> Self {
        Self { role: "assistant", content: content.into(), cacheable: false, images: Vec::new() }
    }
    /// A user message with one attached image (see `images` above).
    pub fn user_with_image(content: impl Into<String>, image_png_base64: impl Into<String>) -> Self {
        Self::user_with_images(content, vec![image_png_base64.into()])
    }
    /// A user message with any number of attached images, in order.
    pub fn user_with_images(content: impl Into<String>, images: Vec<String>) -> Self {
        Self { role: "user", content: content.into(), cacheable: false, images }
    }
    /// A user message worth caching (see `cacheable` above).
    pub fn cacheable_user(content: impl Into<String>) -> Self {
        Self { role: "user", content: content.into(), cacheable: true, images: Vec::new() }
    }
}

/// The MIME type of a base64-encoded image, from its magic bytes — overlay
/// screenshots are JPEG, everything else attached so far is PNG. Providers
/// reject an image whose declared type doesn't match its bytes.
pub fn image_mime(base64_image: &str) -> &'static str {
    if base64_image.starts_with("/9j/") {
        "image/jpeg"
    } else {
        "image/png"
    }
}

/// Strips a JSON object out of a raw LLM response that may be wrapped in
/// markdown code fences or surrounded by prose — ports
/// `apps/backend/app/services/analysis_service.py`'s `_extract_json_object`
/// (shared, in the Python codebase, by analysis/notes summarize).
/// Finds the substring from the first `{` to the last `}` after stripping
/// a leading/trailing ``` fence (with an optional `json` language label).
pub fn extract_json_object(raw: &str) -> Result<String, String> {
    let mut text = raw.trim();

    if let Some(rest) = text.strip_prefix("```") {
        let rest = rest.strip_prefix("json").unwrap_or(rest);
        let rest = rest.trim_start_matches(['\r', '\n']);
        text = rest.strip_suffix("```").unwrap_or(rest).trim();
    }

    let start = text.find('{').ok_or_else(|| "no JSON object found in model response".to_string())?;
    let end = text.rfind('}').ok_or_else(|| "no JSON object found in model response".to_string())?;
    if end < start {
        return Err("no JSON object found in model response".to_string());
    }
    Ok(text[start..=end].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_plain_json() {
        assert_eq!(extract_json_object(r#"{"a": 1}"#).unwrap(), r#"{"a": 1}"#);
    }

    #[test]
    fn strips_markdown_fence_with_json_label() {
        let raw = "```json\n{\"a\": 1}\n```";
        assert_eq!(extract_json_object(raw).unwrap(), "{\"a\": 1}");
    }

    #[test]
    fn strips_markdown_fence_without_label() {
        let raw = "```\n{\"a\": 1}\n```";
        assert_eq!(extract_json_object(raw).unwrap(), "{\"a\": 1}");
    }

    #[test]
    fn extracts_json_surrounded_by_prose() {
        let raw = "Sure, here you go:\n{\"a\": 1}\nHope that helps!";
        assert_eq!(extract_json_object(raw).unwrap(), "{\"a\": 1}");
    }

    #[test]
    fn errors_when_no_braces_present() {
        assert!(extract_json_object("no json here").is_err());
    }
}
