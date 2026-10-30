// AI spend per user and per interview session. Request body:
// { userIds: string[] } (max 200). admin_user_ai_costs() embeds its own
// admin check. With OPENAI_ADMIN_KEY set, costs are the user's share of
// OpenAI's real daily bill for the app key (see realCostByDay); otherwise
// they're the list-price estimates. Deepgram (speech-to-text) cost is exact
// per interview: each interview has its own Deepgram key, and Deepgram
// reports each request's cost and key (see _shared/deepgramCosts.ts).

import { adminErrorResponse, getUserClient, handlePreflight, jsonResponse, throwOnRpcError } from "../_shared/admin.ts";
import { realCostByDay, usdToInr } from "../_shared/openaiCosts.ts";
import { serviceClient, syncDeepgramCosts } from "../_shared/deepgramCosts.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CostRow {
  userId: string;
  sessionId: string | null;
  day: string;
  calls: number;
  estimatedCostUsd: number;
}

interface UserCost {
  totalUsd: number; // OpenAI
  calls: number;
  deepgramUsd: number;
  sessions: Record<string, { costUsd: number; calls: number; deepgramUsd: number }>;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const userIds: string[] = Array.isArray(body.userIds)
      ? [...new Set(body.userIds.filter((id: unknown) => typeof id === "string" && UUID.test(id)))] as string[]
      : [];
    if (userIds.length > 200) return jsonResponse({ error: "Too many userIds" }, 400);

    const client = getUserClient(req);
    const { data, error } = await client.rpc("admin_user_ai_costs", { p_user_ids: userIds });
    if (error) throwOnRpcError(error);

    const rows = (data?.rows ?? []) as CostRow[];
    const dayTotals = new Map(Object.entries((data?.dayTotals ?? {}) as Record<string, number>));

    // The RPC above passed its admin check, so the service-role sync is safe.
    const [real, inrRate] = await Promise.all([
      realCostByDay(dayTotals).catch((err) => {
        console.error("admin-user-ai-costs: real cost lookup failed", err);
        return null;
      }),
      usdToInr(),
      syncDeepgramCosts(serviceClient()),
    ]);
    const { data: dgRows, error: dgError } = await client.rpc("admin_user_deepgram_costs", { p_user_ids: userIds });
    if (dgError) throwOnRpcError(dgError);

    const users: Record<string, UserCost> = {};
    for (const r of rows) {
      const cost = real ? r.estimatedCostUsd * (real.factorByDay.get(r.day) ?? 0) : r.estimatedCostUsd;
      const u = (users[r.userId] ??= { totalUsd: 0, calls: 0, deepgramUsd: 0, sessions: {} });
      u.totalUsd += cost;
      u.calls += r.calls;
      if (r.sessionId) {
        const s = (u.sessions[r.sessionId] ??= { costUsd: 0, calls: 0, deepgramUsd: 0 });
        s.costUsd += cost;
        s.calls += r.calls;
      }
    }

    for (const d of (dgRows ?? []) as { userId: string; sessionId: string; usd: number }[]) {
      const u = (users[d.userId] ??= { totalUsd: 0, calls: 0, deepgramUsd: 0, sessions: {} });
      u.deepgramUsd += Number(d.usd);
      const s = (u.sessions[d.sessionId] ??= { costUsd: 0, calls: 0, deepgramUsd: 0 });
      s.deepgramUsd += Number(d.usd);
    }

    return jsonResponse({ costSource: real ? "openai" : "estimate", usdToInr: inrRate, users });
  } catch (err) {
    return adminErrorResponse(err);
  }
});
