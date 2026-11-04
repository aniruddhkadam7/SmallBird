//! OpenAI Chat Completions calls, routed through the `llm-proxy` Supabase
//! Edge Function (see `backend/supabase/functions/llm-proxy/`) instead of
//! calling OpenAI directly — the server holds the real OpenAI key, this
//! module only needs the signed-in user's access token. Body-building and
//! SSE-delta-parsing are unchanged from the old direct-call version, since
//! `llm-proxy` forwards the `payload` verbatim and streams back OpenAI's own
//! native response shape.

use crate::crash_guard::LockExt;
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

/// Thinking level for a gpt-6 model when the caller didn't name one (see
/// `split_model_spec`). gpt-6 rejects "minimal"; it accepts none/low/medium/
/// high/xhigh/max and would default to medium if unset. "low" measured as
/// fast as gpt-4.1 to the first word (~1.2s) with clearly stronger answers.
pub const DEFAULT_GPT6_EFFORT: &str = "low";

/// Callers pick a thinking level per request by naming the model as
/// "model@effort" (e.g. "gpt-6-luna@medium" for Deep, "gpt-6-luna@low" for
/// normal answers — see `personal::client`). Only the model part is sent as
/// `model`; the effort becomes `reasoning_effort`.
fn split_model_spec(spec: &str) -> (&str, Option<&str>) {
    match spec.split_once('@') {
        Some((model, effort)) if !effort.is_empty() => (model, Some(effort)),
        _ => (spec, None),
    }
}

/// Hidden thinking and the visible answer share `max_completion_tokens`. The
/// 300-token buffer that suits gpt-5 at "minimal" would let gpt-6 spend the
/// whole budget thinking and return nothing, so it gets far more headroom.
/// Only tokens actually generated are billed, so a high cap costs nothing
/// extra on its own.
fn reasoning_buffer(model: &str) -> u32 {
    if model.starts_with("gpt-6") { 6000 } else { REASONING_TOKEN_BUFFER }
}

/// A deep answer thinks before it streams, and the request timeout covers
/// the whole streamed body — 30s could cut a long deep answer off mid-way.
fn timeout_for(model: &str) -> Duration {
    Duration::from_secs(if model.starts_with("gpt-6") { 120 } else { REQUEST_TIMEOUT_SECS })
}

/// Dev builds only: overrides the gpt-6 thinking level, for measuring levels
/// against each other without a rebuild (see `client::debug_set_ask_model`).
static DEV_EFFORT_OVERRIDE: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

pub fn set_dev_effort_override(effort: Option<String>) {
    if cfg!(debug_assertions) {
        *DEV_EFFORT_OVERRIDE.lock_safe() = effort.filter(|e| !e.trim().is_empty());
    }
}

fn effort_for(model: &str, requested: Option<&str>) -> String {
    if cfg!(debug_assertions) && model.starts_with("gpt-6") {
        if let Some(effort) = DEV_EFFORT_OVERRIDE.lock_safe().clone() {
            return effort;
        }
    }
    if let Some(effort) = requested {
        return effort.to_string();
    }
    if model.starts_with("gpt-6") {
        DEFAULT_GPT6_EFFORT.to_string()
    } else {
        REASONING_EFFORT.to_string()
    }
}

/// How to phrase the request's sampling/length parameters. `Auto` picks by
/// model name (`is_reasoning_model`); the other two are what
/// `post_with_param_fallback` retries with when OpenAI rejects the auto
/// choice — a model family newer than this list (e.g. a "gpt-6") would
/// otherwise fail every call with a 400 until this file learned its name.
#[derive(Clone, Copy, PartialEq, Debug)]
enum ParamStyle {
    Auto,
    Classic,
    Reasoning { with_effort: bool },
}

fn build_request_body(model: &str, messages: &[ChatMessage], temperature: f32, max_tokens: u32, stream: bool) -> serde_json::Value {
    let (model, effort) = split_model_spec(model);
    build_request_body_styled(model, effort, messages, temperature, max_tokens, stream, ParamStyle::Auto)
}

fn build_request_body_styled(
    model: &str,
    effort: Option<&str>,
    messages: &[ChatMessage],
    temperature: f32,
    max_tokens: u32,
    stream: bool,
    style: ParamStyle,
) -> serde_json::Value {
    let messages_json = messages
        .iter()
        .map(|m| {
            if !m.images.is_empty() {
                let mut content: Vec<serde_json::Value> = m
                    .images
                    .iter()
                    .map(|image| serde_json::json!({ "type": "image_url", "image_url": { "url": format!("data:{};base64,{image}", crate::personal::prompts::image_mime(image)) } }))
                    .collect();
                content.push(serde_json::json!({ "type": "text", "text": m.content }));
                serde_json::json!({ "role": m.role, "content": content })
            } else {
                serde_json::json!({"role": m.role, "content": m.content})
            }
        })
        .collect::<Vec<_>>();

    let style = resolve_style(style, model);
    match style {
        ParamStyle::Reasoning { with_effort } => {
            let mut body = serde_json::json!({
                "model": model,
                "messages": messages_json,
                "max_completion_tokens": max_tokens + reasoning_buffer(model),
                "stream": stream,
            });
            if with_effort {
                body["reasoning_effort"] = serde_json::json!(effort_for(model, effort));
            }
            body
        }
        _ => serde_json::json!({
            "model": model,
            "messages": messages_json,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": stream,
        }),
    }
}

/// Which parameter style to retry with after OpenAI rejected `tried` with
/// `error_body`, or `None` when the error isn't about those parameters.
/// The concrete style `Auto` means for `model`: the gpt-6 family takes the
/// reasoning-style params (with its own effort level, `effort_for`) on the
/// first try — no rejected round-trips.
fn resolve_style(style: ParamStyle, model: &str) -> ParamStyle {
    match style {
        ParamStyle::Auto if model.starts_with("gpt-6") || is_reasoning_model(model) => ParamStyle::Reasoning { with_effort: true },
        ParamStyle::Auto => ParamStyle::Classic,
        other => other,
    }
}

fn fallback_style(tried: ParamStyle, model: &str, error_body: &str) -> Option<ParamStyle> {
    let effective = resolve_style(tried, model);
    let body = error_body.to_lowercase();
    match effective {
        ParamStyle::Classic if body.contains("max_tokens") || body.contains("temperature") || body.contains("max_completion_tokens") => {
            Some(ParamStyle::Reasoning { with_effort: true })
        }
        ParamStyle::Reasoning { with_effort: true } if body.contains("reasoning_effort") => {
            Some(ParamStyle::Reasoning { with_effort: false })
        }
        _ => None,
    }
}

/// POSTs to the proxy, and on a 400 that complains about the sampling/length
/// parameters, retries (at most twice) with the other parameter style — see
/// `ParamStyle`. Any other failure is returned as-is.
async fn post_with_param_fallback(
    access_token: &str,
    model: &str,
    effort: Option<&str>,
    messages: &[ChatMessage],
    temperature: f32,
    max_tokens: u32,
    stream: bool,
) -> Result<reqwest::Response, String> {
    let client = shared_client();
    let mut style = ParamStyle::Auto;
    for attempt in 0..3 {
        let payload = build_request_body_styled(model, effort, messages, temperature, max_tokens, stream, style);
        let response = client
            .post(llm_proxy_url())
            .bearer_auth(access_token)
            .timeout(timeout_for(model))
            .json(&serde_json::json!({ "provider": "openai", "payload": payload }))
            .send()
            .await
            .map_err(|e| format!("failed to reach SmallBird AI's AI service: {e}"))?;

        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }
        let text = response.text().await.unwrap_or_default();
        match fallback_style(style, model, &text) {
            Some(next) if status == reqwest::StatusCode::BAD_REQUEST && attempt < 2 => {
                log::warn!("openai: {model} rejected {style:?} params, retrying as {next:?}");
                style = next;
            }
            _ => return Err(format!("OpenAI returned {status}: {text}")),
        }
    }
    Err("OpenAI rejected every parameter style for this model".to_string())
}

pub async fn generate(access_token: &str, model: &str, messages: &[ChatMessage], temperature: f32, max_tokens: u32) -> Result<String, String> {
    let (model, effort) = split_model_spec(model);
    let response = post_with_param_fallback(access_token, model, effort, messages, temperature, max_tokens, false).await?;

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
    let started = std::time::Instant::now();
    let (model_name, effort) = split_model_spec(model);
    let response = post_with_param_fallback(access_token, model_name, effort, messages, temperature, max_tokens, true).await?;
    let headers_ms = started.elapsed().as_millis();

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut pending_bytes = Vec::new();
    let mut chunks = 0u32;
    let mut first_chunk_ms = None;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("stream read error: {e}"))?;
        chunks += 1;
        first_chunk_ms.get_or_insert_with(|| started.elapsed().as_millis());
        super::push_utf8_chunk(&mut pending_bytes, &mut buffer, &chunk);

        for delta in drain_sse_deltas(&mut buffer) {
            if let Some(text) = delta {
                on_delta(&text);
            }
        }
    }

    // One line per answer: whether the answer actually streams (many chunks,
    // first one early) or arrives in one lump at the end — the difference
    // between words appearing within a second and a multi-second blank wait.
    log::info!(
        "openai stream: model={model} headers_ms={headers_ms} first_chunk_ms={} chunks={chunks} total_ms={}",
        first_chunk_ms.unwrap_or(0),
        started.elapsed().as_millis()
    );
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
    fn unknown_new_model_falls_back_to_reasoning_params_then_drops_effort() {
        // A model family this file doesn't know yet (named "gpt-9" here).
        let rejected_max_tokens = r#"{"error":{"message":"Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."}}"#;
        let next = fallback_style(ParamStyle::Auto, "gpt-9-x", rejected_max_tokens);
        assert_eq!(next, Some(ParamStyle::Reasoning { with_effort: true }));

        let rejected_effort = r#"{"error":{"message":"Unsupported value: 'reasoning_effort' does not support 'minimal' with this model."}}"#;
        assert_eq!(fallback_style(next.unwrap(), "gpt-9-x", rejected_effort), Some(ParamStyle::Reasoning { with_effort: false }));

        // Unrelated errors (bad model name, auth) are not retried.
        assert_eq!(fallback_style(ParamStyle::Auto, "gpt-9-x", r#"{"error":{"message":"The model `gpt-9-x` does not exist"}}"#), None);

        // gpt-6 is known: reasoning-style params with its own effort, first try.
        assert_eq!(resolve_style(ParamStyle::Auto, "gpt-6-sol"), ParamStyle::Reasoning { with_effort: true });
        let body = build_request_body("gpt-6-sol", &[], 0.5, 400, true);
        assert_eq!(body["model"], "gpt-6-sol");
        assert_eq!(body["reasoning_effort"], DEFAULT_GPT6_EFFORT);
        assert_eq!(body["max_completion_tokens"], 400 + 6000);
        assert!(body.get("temperature").is_none());

        // A per-request level rides on the model spec; only the model name is sent.
        let deep = build_request_body("gpt-6-sol@medium", &[], 0.5, 400, true);
        assert_eq!(deep["model"], "gpt-6-sol");
        assert_eq!(deep["reasoning_effort"], "medium");
    }

    #[test]
    fn reasoning_body_without_effort_omits_it() {
        let body = build_request_body_styled("x", None, &[], 0.5, 100, true, ParamStyle::Reasoning { with_effort: false });
        assert!(body.get("reasoning_effort").is_none());
        assert!(body.get("temperature").is_none());
        assert_eq!(body["max_completion_tokens"], 100 + REASONING_TOKEN_BUFFER);
    }

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
