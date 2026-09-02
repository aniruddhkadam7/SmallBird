// Forwards chat/analysis requests to the user's chosen LLM provider using
// OUR api key (never shipped to the client), after checking their plan is
// valid. Streams the provider's response straight back through, and logs
// token counts into usage_costs for billing/analytics.
//
// Request body: { provider: "openai" | "anthropic", payload: <provider's
// native request body>, sessionId?: string, requestKind?: string }

import { entitlementErrorResponse, requireEntitlement } from "../_shared/entitlement.ts";

const PROVIDER_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
};

// Rough $/1K token rates for estimated_cost_usd — update as pricing changes.
// This is an estimate for internal cost tracking, not a billing-grade figure.
const RATE_PER_1K: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4o": { input: 0.0025, output: 0.01 },
  "claude-3-5-sonnet-20241022": { input: 0.003, output: 0.015 },
};

Deno.serve(async (req) => {
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

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (provider === "openai") {
      headers["Authorization"] = `Bearer ${Deno.env.get("OPENAI_API_KEY")}`;
    } else if (provider === "anthropic") {
      headers["x-api-key"] = Deno.env.get("ANTHROPIC_API_KEY")!;
      headers["anthropic-version"] = "2023-06-01";
    }

    const providerResp = await fetch(providerUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

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
});
