// Forwards chat/analysis requests to the user's chosen LLM provider using
// OUR api key (never shipped to the client), after checking their plan is
// valid. Streams the provider's response straight back through, and logs
// token counts into usage_costs for billing/analytics.
//
// Request body: { provider: "openai" | "anthropic", payload: <provider's
// native request body>, sessionId?: string, requestKind?: string }

import { createClient } from "npm:@supabase/supabase-js@2";
import { entitlementErrorResponse, requireEntitlement, userIdFromVerifiedJwt } from "../_shared/entitlement.ts";
import { withCors } from "../_shared/cors.ts";
import { isAllowedModel, MAX_BODY_BYTES, sanitizePayload, withinRateLimit } from "../_shared/llmguard.ts";

const guardAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });
}

const PROVIDER_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
};

// Rough $/1K token rates for estimated_cost_usd — update as pricing changes.
// This is an estimate for internal cost tracking, not a billing-grade figure.
const RATE_PER_1K: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4o": { input: 0.0025, output: 0.01 },
  "gpt-5-mini": { input: 0.00025, output: 0.002 },
  "claude-3-5-sonnet-20241022": { input: 0.003, output: 0.015 },
};

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return jsonError("Request too large", 413);
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearers+/i, "");
    // The rate check runs alongside the entitlement lookup, so it adds no
    // latency in front of the answer.
    const [entitlement, allowed, raw] = await Promise.all([
      requireEntitlement(req),
      jwt ? withinRateLimit(guardAdmin, userIdFromVerifiedJwt(jwt)).catch(() => true) : Promise.resolve(true),
      req.text(),
    ]);
    if (!allowed) return jsonError("Too many requests — please slow down and try again in a minute", 429);
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
    const payload = sanitizePayload(rawPayload);

    const providerUrl = PROVIDER_URLS[provider];
    if (!providerUrl) {
      return new Response(JSON.stringify({ error: `Unsupported provider: ${provider}` }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (provider === "openai") {
      headers["Authorization"] = `Bearer ${Deno.env.get("OPENAI_API_KEY")}`;
    } else if (provider === "anthropic") {
      headers["x-api-key"] = Deno.env.get("ANTHROPIC_API_KEY")!;
      headers["anthropic-version"] = "2023-06-01";
      // Interview Mode's Ask AI sends a cache_control breakpoint on its
      // (large, per-session-identical) system prompt to cut the
      // time-to-first-token on every question after the first — this beta
      // header is required for that to take effect.
      headers["anthropic-beta"] = "prompt-caching-2024-07-31";
    }

    // OpenAI's paid "priority" service tier trades money for materially
    // lower latency on the same model (the same lever ChatGPT's own
    // first-party surface benefits from vs. the plain public API) — this is
    // an unverified account entitlement, not a certainty, so this always
    // falls back to a normal request rather than ever failing a live
    // interview answer over it. Only attempted for a real (non-streaming
    // cost-check) first try; see the fallback below.
    let providerResp = await fetch(providerUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(provider === "openai" ? { ...payload, service_tier: "priority" } : payload),
    });

    if (provider === "openai" && providerResp.status === 400) {
      const probe = await providerResp.clone().text();
      if (probe.includes("service_tier") || probe.includes("priority")) {
        console.warn("OpenAI priority service_tier unavailable on this account, falling back to default tier");
        providerResp = await fetch(providerUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
      }
    }

    // Best-effort cost accounting — a streaming body won't parse as JSON
    // here, which is fine, it just skips logging for that call.
    providerResp
      .clone()
      .json()
      .then((json) => {
        const model: string = json?.model ?? payload?.model ?? "unknown";
        const inputTokens = json?.usage?.prompt_tokens ?? json?.usage?.input_tokens ?? 0;
        const outputTokens = json?.usage?.completion_tokens ?? json?.usage?.output_tokens ?? 0;
        if (inputTokens === 0 && outputTokens === 0) return;

        const rate = RATE_PER_1K[model];
        const estimatedCostUsd = rate
          ? (inputTokens / 1000) * rate.input + (outputTokens / 1000) * rate.output
          : null;

        entitlement.admin
          .from("usage_costs")
          .insert({
            user_id: entitlement.userId,
            provider,
            model,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            estimated_cost_usd: estimatedCostUsd,
            request_kind: requestKind ?? null,
            session_id: sessionId ?? null,
          })
          .then(({ error }) => error && console.error("usage_costs insert failed", error));
      })
      .catch(() => {
        // Non-JSON (streaming) response — nothing to log for this call.
      });

    return new Response(providerResp.body, {
      status: providerResp.status,
      headers: { "content-type": providerResp.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    return entitlementErrorResponse(err);
  }
}));
