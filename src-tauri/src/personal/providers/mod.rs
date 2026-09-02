pub mod anthropic;
pub mod openai;

/// Request timeout for `llm-proxy` calls — matches
/// `apps/backend/app/services/llm/*_provider.py`'s
/// `_REQUEST_TIMEOUT_SECONDS = 30.0` (a hung upstream call must not hang the
/// desktop app indefinitely).
pub const REQUEST_TIMEOUT_SECS: u64 = 30;

/// TODO(deploy): same Supabase project as `auth::client`/`stt::backend_token`
/// — keep in sync (or factor into one shared constant once finalized).
const SUPABASE_URL: &str = "https://xubbwgrjvvsbfvxcuzav.supabase.co";

pub fn llm_proxy_url() -> String {
    format!("{SUPABASE_URL}/functions/v1/llm-proxy")
}
