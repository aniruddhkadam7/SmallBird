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

/// Appends a streamed network chunk to `text`. A multi-byte UTF-8 character
/// (curly quotes, em dashes, emoji, any non-English text) can be split across
/// two chunks; decoding each chunk on its own turned both halves into U+FFFD
/// ("�") in the answer. The incomplete tail is held in `pending` until the
/// rest arrives. Genuinely invalid bytes still become U+FFFD.
pub fn push_utf8_chunk(pending: &mut Vec<u8>, text: &mut String, chunk: &[u8]) {
    pending.extend_from_slice(chunk);
    let mut start = 0;
    loop {
        match std::str::from_utf8(&pending[start..]) {
            Ok(valid) => {
                text.push_str(valid);
                pending.clear();
                return;
            }
            Err(err) => {
                let valid_end = start + err.valid_up_to();
                text.push_str(&String::from_utf8_lossy(&pending[start..valid_end]));
                match err.error_len() {
                    // Incomplete sequence at the end: wait for the next chunk.
                    None => {
                        pending.drain(..valid_end);
                        return;
                    }
                    Some(bad_len) => {
                        text.push(char::REPLACEMENT_CHARACTER);
                        start = valid_end + bad_len;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::push_utf8_chunk;

    #[test]
    fn joins_characters_split_across_chunks() {
        let original = "It’s — café 🚀";
        let bytes = original.as_bytes();
        for split in 0..=bytes.len() {
            let (mut pending, mut text) = (Vec::new(), String::new());
            push_utf8_chunk(&mut pending, &mut text, &bytes[..split]);
            push_utf8_chunk(&mut pending, &mut text, &bytes[split..]);
            assert_eq!(text, original, "split at byte {split}");
            assert!(pending.is_empty());
        }
    }

    #[test]
    fn replaces_invalid_bytes_and_keeps_going() {
        let (mut pending, mut text) = (Vec::new(), String::new());
        push_utf8_chunk(&mut pending, &mut text, &[b'a', 0xff, b'b']);
        assert_eq!(text, "a\u{FFFD}b");
        assert!(pending.is_empty());
    }
}
