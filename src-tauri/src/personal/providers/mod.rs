pub mod anthropic;
pub mod openai;

use std::sync::OnceLock;

/// Request timeout for `llm-proxy` calls — matches
/// `apps/backend/app/services/llm/*_provider.py`'s
/// `_REQUEST_TIMEOUT_SECONDS = 30.0` (a hung upstream call must not hang the
/// desktop app indefinitely).
pub const REQUEST_TIMEOUT_SECS: u64 = 30;

/// One shared, connection-pooling client for every `llm-proxy` call, reused
/// across every Ask AI question in this process instead of each `generate`/
/// `stream` call building its own `reqwest::Client`. A fresh `Client` has no
/// warm TLS session to Supabase's edge function host, so every question was
/// paying a full TCP+TLS handshake on top of the model's own latency before
/// the first byte of the answer could even start — this keeps that
/// connection (and its TLS session) alive between questions via reqwest's
/// built-in pooling.
pub fn shared_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(reqwest::Client::new)
}

/// TODO(deploy): same Supabase project as `auth::client`/`stt::backend_token`
/// — keep in sync (or factor into one shared constant once finalized).
const SUPABASE_URL: &str = "https://xubbwgrjvvsbfvxcuzav.supabase.co";

/// `llm-proxy-v2`, not the original `llm-proxy`: v1 held every streamed
/// answer back until the provider had finished (measured: headers and all
/// SSE chunks arriving together at the very end), so words never appeared
/// progressively. v2 streams chunks through as they arrive — see its header
/// comment. v1 stays deployed for already-installed older versions.
pub fn llm_proxy_url() -> String {
    format!("{SUPABASE_URL}/functions/v1/llm-proxy-v2")
}
