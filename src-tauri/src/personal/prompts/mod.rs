pub mod ask;
pub mod analysis;
pub mod notes;
pub mod screen;
pub mod setup;

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
    /// A base64-encoded PNG attached to this message, for vision requests
    /// (the "Analyze Screen" flow — see `prompts::screen`). `None` for every
    /// ordinary text-only message.
    pub image_png_base64: Option<String>,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self { role: "system", content: content.into(), cacheable: false, image_png_base64: None }
    }
    pub fn user(content: impl Into<String>) -> Self {
        Self { role: "user", content: content.into(), cacheable: false, image_png_base64: None }
    }
    pub fn assistant(content: impl Into<String>) -> Self {
        Self { role: "assistant", content: content.into(), cacheable: false, image_png_base64: None }
    }
    /// A user message with an attached screenshot (see `image_png_base64`
    /// above).
    pub fn user_with_image(content: impl Into<String>, image_png_base64: impl Into<String>) -> Self {
        Self {
            role: "user",
            content: content.into(),
            cacheable: false,
            image_png_base64: Some(image_png_base64.into()),
        }
    }
    /// A user message worth caching (see `cacheable` above).
    pub fn cacheable_user(content: impl Into<String>) -> Self {
        Self { role: "user", content: content.into(), cacheable: true, image_png_base64: None }
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
