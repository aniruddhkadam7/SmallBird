// llm-proxy, rebuilt so streamed answers actually stream.
//
// The original llm-proxy returned `new Response(providerResp.body)` after
// calling `providerResp.clone().json()` for cost logging. Measured from the
// desktop app, every streamed answer arrived in one lump: response headers
// only after the provider had finished (headers_ms == total_ms, all SSE
// chunks within ~6ms) — so users stared at a blank answer for the entire
// generation time instead of seeing words within a second. This version:
//   - never clones/tees the body; streamed responses pass through a
//     TransformStream that forwards every chunk the moment it arrives and
//     only *reads* token usage out of it on the side,
//   - sends explicit SSE headers (no-cache, no-transform, X-Accel-Buffering:
//     no) so nothing between here and the app buffers the stream,
//   - asks OpenAI for `stream_options.include_usage`, so streamed answers are
//     finally cost-logged too (the old clone().json() silently skipped every
//     streamed call).
//
// Request body is unchanged: { provider: "openai" | "anthropic", payload:
// <provider's native request body>, sessionId?, requestKind? }.

import { entitlementErrorResponse, requireEntitlement } from "../_shared/entitlement.ts";
import { withCors } from "../_shared/cors.ts";

const PROVIDER_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
};

// Rough $/1K token rates for estimated_cost_usd — an internal estimate, not
// billing-grade. Source: developers.openai.com/api/docs/pricing (Sept 2026).
const RATE_PER_1K: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4o": { input: 0.0025, output: 0.01 },
  "gpt-4.1": { input: 0.002, output: 0.008 },
  "gpt-4.1-mini": { input: 0.0004, output: 0.0016 },
  "gpt-5-mini": { input: 0.00025, output: 0.002 },
  "gpt-6-sol": { input: 0.002, output: 0.01 },
  "gpt-6-luna": { input: 0.0001, output: 0.0005 },
  "claude-3-5-sonnet-20241022": { input: 0.003, output: 0.015 },
};

type Usage = { model: string; inputTokens: number; outputTokens: number };

function rateFor(model: string) {
  // Providers often answer with a dated snapshot name (e.g. gpt-4.1-2025-04-14).
  const key = Object.keys(RATE_PER_1K)
    .sort((a, b) => b.length - a.length)
    .find((k) => model === k || model.startsWith(`${k}-`));
  return key ? RATE_PER_1K[key] : undefined;
}

/// Pulls token usage out of one SSE `data:` JSON event, for either provider.
/// Mutates `usage` — OpenAI sends it once at the end (with include_usage);
/// Anthropic splits it across message_start (input) and message_delta (output).
function absorbUsage(event: any, usage: Usage) {
  if (event?.model && usage.model === "unknown") usage.model = event.model;
  if (event?.usage) {
    usage.inputTokens = event.usage.prompt_tokens ?? event.usage.input_tokens ?? usage.inputTokens;
    usage.outputTokens = event.usage.completion_tokens ?? event.usage.output_tokens ?? usage.outputTokens;
  }
  if (event?.type === "message_start" && event.message) {
    if (event.message.model) usage.model = event.message.model;
    usage.inputTokens = event.message.usage?.input_tokens ?? usage.inputTokens;
  }
}

/// Forwards every chunk untouched and immediately; scans complete SSE lines
/// for usage on the side and hands the total to `onDone` when the stream ends.
function usageTap(initialModel: string, onDone: (usage: Usage) => void): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const usage: Usage = { model: initialModel, inputTokens: 0, outputTokens: 0 };
  let pending = "";
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      pending += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          absorbUsage(JSON.parse(data), usage);
        } catch {
          // Not JSON — nothing to learn from it; the chunk was already forwarded.
        }
      }
    },
    flush() {
      onDone(usage);
    },
  });
}

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const entitlement = await requireEntitlement(req);
    const { provider, payload, sessionId, requestKind } = await req.json();

    const providerUrl = PROVIDER_URLS[provider];
    if (!providerUrl) {
      return new Response(JSON.stringify({ error: `Unsupported provider: ${provider}` }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const streaming = payload?.stream === true;
    const headers: Record<string, string> = { "content-type": "application/json" };
    let body = payload;
    if (provider === "openai") {
      headers["Authorization"] = `Bearer ${Deno.env.get("OPENAI_API_KEY")}`;
      if (streaming) body = { ...payload, stream_options: { ...(payload.stream_options ?? {}), include_usage: true } };
    } else if (provider === "anthropic") {
      headers["x-api-key"] = Deno.env.get("ANTHROPIC_API_KEY")!;
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-beta"] = "prompt-caching-2024-07-31";
    }

    // Same priority-tier attempt + fallback as the original llm-proxy.
    let providerResp = await fetch(providerUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(provider === "openai" ? { ...body, service_tier: "priority" } : body),
    });
    if (provider === "openai" && providerResp.status === 400) {
      const probe = await providerResp.clone().text();
      if (probe.includes("service_tier") || probe.includes("priority")) {
        console.warn("OpenAI priority service_tier unavailable on this account, falling back to default tier");
        providerResp = await fetch(providerUrl, { method: "POST", headers, body: JSON.stringify(body) });
      }
    }

    const logUsage = ({ model, inputTokens, outputTokens }: Usage) => {
      if (inputTokens === 0 && outputTokens === 0) return;
      const rate = rateFor(model);
      entitlement.admin
        .from("usage_costs")
        .insert({
          user_id: entitlement.userId,
          provider,
          model,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          estimated_cost_usd: rate ? (inputTokens / 1000) * rate.input + (outputTokens / 1000) * rate.output : null,
          request_kind: requestKind ?? null,
          session_id: sessionId ?? null,
        })
        .then(({ error }) => error && console.error("usage_costs insert failed", error));
    };

    // Errors and non-streamed calls: small bodies, read once, log, return.
    if (!streaming || !providerResp.ok || !providerResp.body) {
      const text = await providerResp.text();
      try {
        const json = JSON.parse(text);
        const usage: Usage = { model: payload?.model ?? "unknown", inputTokens: 0, outputTokens: 0 };
        absorbUsage(json, usage);
        logUsage(usage);
      } catch {
        // Non-JSON error body — pass it through as-is.
      }
      return new Response(text, {
        status: providerResp.status,
        headers: { "content-type": providerResp.headers.get("content-type") ?? "application/json" },
      });
    }

    return new Response(providerResp.body.pipeThrough(usageTap(payload?.model ?? "unknown", logUsage)), {
      status: providerResp.status,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
      },
    });
  } catch (err) {
    return entitlementErrorResponse(err);
  }
}));
