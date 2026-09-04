//! OpenAI Chat Completions calls, routed through the `llm-proxy` Supabase
//! Edge Function (see `backend/supabase/functions/llm-proxy/`) instead of
//! calling OpenAI directly — the server holds the real OpenAI key, this
//! module only needs the signed-in user's access token. Body-building and
//! SSE-delta-parsing are unchanged from the old direct-call version, since
//! `llm-proxy` forwards the `payload` verbatim and streams back OpenAI's own
//! native response shape.

use std::time::Duration;

use futures_util::StreamExt;

use crate::personal::prompts::ChatMessage;
use super::{llm_proxy_url, shared_client, REQUEST_TIMEOUT_SECS};

/// GPT-5/o-series "reasoning" models reject the classic Chat Completions
/// `temperature` and `max_tokens` params outright with a 400 error — they
/// need `max_completion_tokens` instead, and only support the default
/// temperature (1), so `temperature` must be omitted entirely rather than
/// sent as any explicit value.
fn is_reasoning_model(model: &str) -> bool {
    model.starts_with("gpt-5") || model.starts_with("o1") || model.starts_with("o3") || model.starts_with("o4")
}

/// Extra headroom added on top of the caller's requested `max_tokens` for a
/// reasoning model only — `max_completion_tokens` caps hidden reasoning
/// tokens AND the visible answer combined, and our per-question budgets
/// (ask::length_target, 75-700) were tuned for a non-reasoning model where
/// every token is visible output, so without this buffer a reasoning model
/// can spend the entire budget "thinking" and stream back nothing at all.
const REASONING_TOKEN_BUFFER: u32 = 300;

/// `"none"` was tried and rejected outright by the API for this model with a
/// 400 (confirmed live, not just documentation) — it is NOT a valid
/// `reasoning_effort` value for gpt-5-mini via Chat Completions, whatever
/// other GPT-5-family versions may accept. `"minimal"` is the lowest value
/// actually confirmed to work: fast, but see `prompts::ask::SYSTEM_PROMPT`'s
/// caveat that Markdown compliance isn't guaranteed regardless of this
/// setting — GPT-5-family models suppress Markdown in API mode by default,
/// independent of reasoning effort.
const REASONING_EFFORT: &str = "minimal";

fn build_request_body(model: &str, messages: &[ChatMessage], temperature: f32, max_tokens: u32, stream: bool) -> serde_json::Value {
    let messages_json = messages
        .iter()
        .map(|m| {
            if let Some(image) = &m.image_png_base64 {
                serde_json::json!({
                    "role": m.role,
                    "content": [
                        { "type": "image_url", "image_url": { "url": format!("data:image/png;base64,{image}") } },
                        { "type": "text", "text": m.content },
                    ],
                })
            } else {
                serde_json::json!({"role": m.role, "content": m.content})
            }
        })
        .collect::<Vec<_>>();

    if is_reasoning_model(model) {
        serde_json::json!({
            "model": model,
            "messages": messages_json,
            "max_completion_tokens": max_tokens + REASONING_TOKEN_BUFFER,
            "reasoning_effort": REASONING_EFFORT,
            "stream": stream,
        })
    } else {
        serde_json::json!({
            "model": model,
            "messages": messages_json,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": stream,
        })
    }
}

pub async fn generate(access_token: &str, model: &str, messages: &[ChatMessage], temperature: f32, max_tokens: u32) -> Result<String, String> {
    let client = shared_client();
    let payload = build_request_body(model, messages, temperature, max_tokens, false);

    let response = client
        .post(llm_proxy_url())
        .bearer_auth(access_token)
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .json(&serde_json::json!({ "provider": "openai", "payload": payload }))
        .send()
        .await
        .map_err(|e| format!("failed to reach Smallbird's AI service: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI returned {status}: {text}"));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| format!("OpenAI returned an unexpected response: {e}"))?;
    Ok(json
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string())
}

pub async fn stream<F>(access_token: &str, model: &str, messages: &[ChatMessage], temperature: f32, max_tokens: u32, mut on_delta: F) -> Result<(), String>
where
    F: FnMut(&str),
{
    let client = shared_client();
    let payload = build_request_body(model, messages, temperature, max_tokens, true);

    let response = client
        .post(llm_proxy_url())
        .bearer_auth(access_token)
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .json(&serde_json::json!({ "provider": "openai", "payload": payload }))
        .send()
        .await
        .map_err(|e| format!("failed to reach Smallbird's AI service: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI returned {status}: {text}"));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("stream read error: {e}"))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        for delta in drain_sse_deltas(&mut buffer) {
            if let Some(text) = delta {
                on_delta(&text);
            }
        }
    }

    Ok(())
}

/// Extracts every complete `data: {...}` SSE line currently in `buffer`,
/// returning `Some(delta_text)` for a normal content chunk, `None` for a
/// chunk with no choices or an empty delta (both skipped, matching the
/// Python provider's `if not chunk.choices: continue` / `if delta:` guards),
/// and stopping (without emitting further items) once `data: [DONE]` is
/// seen. Leaves any trailing partial line in `buffer` for the next network
/// chunk.
fn drain_sse_deltas(buffer: &mut String) -> Vec<Option<String>> {
    let mut out = Vec::new();
    while let Some(newline_pos) = buffer.find('\n') {
        let line = buffer[..newline_pos].trim_end_matches('\r').to_string();
        buffer.drain(..=newline_pos);

        let Some(data) = line.strip_prefix("data: ").or_else(|| line.strip_prefix("data:")) else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() {
            continue;
        }
        if data == "[DONE]" {
            break;
        }

        let parsed: Result<serde_json::Value, _> = serde_json::from_str(data);
        match parsed {
            Ok(json) => {
                let choices = json.get("choices").and_then(|c| c.as_array());
                let Some(choices) = choices else {
                    out.push(None);
                    continue;
                };
                if choices.is_empty() {
                    out.push(None);
                    continue;
                }
                let delta_text = choices[0].get("delta").and_then(|d| d.get("content")).and_then(|c| c.as_str());
                match delta_text {
                    Some(text) if !text.is_empty() => out.push(Some(text.to_string())),
                    _ => out.push(None),
                }
            }
            Err(_) => out.push(None),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_delta_chunk() {
        let mut buffer = "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n".to_string();
        let deltas: Vec<String> = drain_sse_deltas(&mut buffer).into_iter().flatten().collect();
        assert_eq!(deltas, vec!["Hello".to_string()]);
    }

    #[test]
    fn stops_at_done_marker() {
        let mut buffer = "data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\ndata: [DONE]\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"ignored\"}}]}\n\n".to_string();
        let deltas: Vec<String> = drain_sse_deltas(&mut buffer).into_iter().flatten().collect();
        assert_eq!(deltas, vec!["Hi".to_string()]);
    }

    #[test]
    fn skips_chunks_with_no_choices() {
        let mut buffer = "data: {\"choices\":[]}\n\n".to_string();
        let deltas = drain_sse_deltas(&mut buffer);
        assert_eq!(deltas, vec![None]);
    }

    #[test]
    fn leaves_trailing_partial_line_in_buffer() {
        let mut buffer = "data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\ndata: {\"choic".to_string();
        let _ = drain_sse_deltas(&mut buffer);
        assert!(buffer.contains("data: {\"choic"));
    }
}
