/// The two AI providers `llm-proxy` (see `backend/supabase/functions/`)
/// supports. Uses the same wire strings already sent today by
/// `AskRequest.llm_provider` (see `backend/types.rs`) and stored by the
/// frontend's `llmProviderSetting.ts`. Gemini was dropped when this build
/// switched from BYOK to backend-metered — `llm-proxy` has no Gemini
/// support, so it's no longer a selectable provider; re-add here (and to
/// `llm-proxy`'s `PROVIDER_URLS`) if Gemini support returns later.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LlmProvider {
    OpenAi,
    Anthropic,
}

impl LlmProvider {
    /// Parses the wire strings already used by `AskRequest.llm_provider`
    /// etc. ("openai" | "anthropic"). Any other string (including the
    /// now-dropped "gemini" and "deepseek", which never had a backend
    /// implementation) returns `None`.
    pub fn from_wire_str(s: &str) -> Option<Self> {
        match s {
            "openai" => Some(Self::OpenAi),
            "anthropic" => Some(Self::Anthropic),
            _ => None,
        }
    }

    pub fn as_wire_str(self) -> &'static str {
        match self {
            Self::OpenAi => "openai",
            Self::Anthropic => "anthropic",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_valid_wire_strings() {
        for s in ["openai", "anthropic"] {
            let provider = LlmProvider::from_wire_str(s).expect("should parse");
            assert_eq!(provider.as_wire_str(), s);
        }
    }

    #[test]
    fn rejects_unknown_or_unimplemented_providers() {
        assert_eq!(LlmProvider::from_wire_str("gemini"), None);
        assert_eq!(LlmProvider::from_wire_str("deepseek"), None);
        assert_eq!(LlmProvider::from_wire_str("bogus"), None);
        assert_eq!(LlmProvider::from_wire_str(""), None);
    }
}
