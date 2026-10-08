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

import { createClient } from "npm:@supabase/supabase-js@2";
import { entitlementErrorResponse, requireEntitlement, userIdFromVerifiedJwt } from "../_shared/entitlement.ts";
import { withCors } from "../_shared/cors.ts";
import { isAllowedModel, MAX_BODY_BYTES, sanitizePayload, withinRateLimit } from "../_shared/llmguard.ts";
import { endSessionIfTimeUp, TIME_UP_MESSAGE } from "../_shared/timelimit.ts";

const guardAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });
}

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

// ---- Model override helpers -------------------------------------------------

interface ModelOverrides {
  main: string;    // overrides gpt-6-sol (answers, deep, analysis, writing, images)
  tracking: string; // overrides gpt-6-luna (background tracking)
}

// Simple module-level cache so we don't hit the DB on every single request.
// Edge function instances are short-lived, so 60s is plenty.
let overrideCache: { overrides: ModelOverrides; expiresAt: number } | null = null;

async function fetchModelOverrides(admin: ReturnType<typeof createClient>): Promise<ModelOverrides> {
  if (overrideCache && Date.now() < overrideCache.expiresAt) return overrideCache.overrides;
  const { data } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", ["llm_main_model", "llm_tracking_model"]);
  const map: Record<string, string> = {};
  for (const row of data ?? []) map[row.key] = row.value;
  const overrides: ModelOverrides = {
    main:     map["llm_main_model"]     ?? "gpt-6-sol",
    tracking: map["llm_tracking_model"] ?? "gpt-6-luna",
  };
  overrideCache = { overrides, expiresAt: Date.now() + 60_000 };
  return overrides;
}

/// Returns true if the model needs reasoning-style params (max_completion_tokens
/// + reasoning_effort instead of max_tokens + temperature).
function isReasoningModel(model: string): boolean {
  return model.startsWith("gpt-6") || model.startsWith("gpt-5") ||
    model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4");
}

/// Applies admin model overrides and translates API parameters when the model
/// family changes (reasoning ↔ classic). Returns a new payload object.
// deno-lint-ignore no-explicit-any
function applyModelOverride(payload: any, overrides: ModelOverrides): any {
  const originalModel: string = payload.model ?? "";
  let newModel = originalModel;

  if (originalModel === "gpt-6-sol")  newModel = overrides.main;
  if (originalModel === "gpt-6-luna") newModel = overrides.tracking;

  if (newModel === originalModel) return payload; // no override active

  const wasReasoning = isReasoningModel(originalModel);
  const nowReasoning = isReasoningModel(newModel);

  const updated = { ...payload, model: newModel };

  if (wasReasoning && !nowReasoning) {
    // Reasoning → classic: max_completion_tokens had a large reasoning buffer
    // added by the Rust client (6000 for gpt-6, 300 for gpt-5). Strip that
    // and convert to max_tokens with a sensible answer cap.
    const buffer = originalModel.startsWith("gpt-6") ? 6000 : 300;
    const answerBudget = Math.min(Math.max((payload.max_completion_tokens ?? 1500) - buffer, 200), 2000);
    delete updated.max_completion_tokens;
    delete updated.reasoning_effort;
    updated.max_tokens = answerBudget;
    if (updated.temperature === undefined) updated.temperature = 1;
  } else if (!wasReasoning && nowReasoning) {
    // Classic → reasoning: convert max_tokens → max_completion_tokens.
    const base = payload.max_tokens ?? 600;
    const buffer = newModel.startsWith("gpt-6") ? 6000 : 300;
    delete updated.max_tokens;
    delete updated.temperature;
    updated.max_completion_tokens = base + buffer;
    updated.reasoning_effort = "low";
  }
  // Same family (both reasoning or both classic): params are compatible as-is.
  return updated;
}

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return jsonError("Request too large", 413);
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearers+/i, "");
    // The rate check runs alongside the entitlement lookup, so it adds no
    // latency in front of the answer.
    const userId = jwt ? userIdFromVerifiedJwt(jwt) : null;
    const [entitlement, allowed, timeUp, raw] = await Promise.all([
      requireEntitlement(req),
      userId ? withinRateLimit(guardAdmin, userId).catch(() => true) : Promise.resolve(true),
      // A session past its time gets no more answers (and is ended here),
      // even if its app stopped sending heartbeats.
      userId ? endSessionIfTimeUp(guardAdmin, userId).catch(() => false) : Promise.resolve(false),
      req.text(),
    ]);
    if (!allowed) return jsonError("Too many requests — please slow down and try again in a minute", 429);
    if (timeUp) return jsonError(TIME_UP_MESSAGE, 402);
    // Minutes are deducted when a session ends, so a balance of 0 means
    // they're used up (a live session's own time is policed by
    // session-heartbeat).
    if (entitlement.remainingMinutes <= 0) {
      return jsonError("You're out of minutes. Top up to keep getting answers.", 402);
    }
    if (raw.length > MAX_BODY_BYTES) return jsonError("Request too large", 413);
    const { provider, payload: rawPayload, sessionId, requestKind } = JSON.parse(raw);
    if (!rawPayload || typeof rawPayload !== "object" || !isAllowedModel(rawPayload.model)) {
      return jsonError(`Unsupported model: ${String(rawPayload?.model ?? "")}`, 400);
    }
    const payload = applyModelOverride(sanitizePayload(rawPayload), await fetchModelOverrides(guardAdmin));

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
