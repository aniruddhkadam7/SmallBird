// AI token/cost usage analytics. admin_ai_usage_summary() and
// admin_ai_usage_daily() embed their own admin check.
//
// usage_costs.estimated_cost_usd is a list-price estimate that runs 25-50%
// low (OpenAI bills the app at the priority tier and prices cached input and
// cache writes differently). When OPENAI_ADMIN_KEY is set, each UTC day's
// real cost for the app's own OpenAI key is shared out over that day's
// usage_costs rows in proportion to their estimates, so per-user and
// per-model costs add up to exactly what OpenAI billed. Real spend on a day
// with no logged calls is reported as unattributedCostUsd.

import { adminErrorResponse, getUserClient, handlePreflight, jsonResponse, throwOnRpcError } from "../_shared/admin.ts";
import { dayKey, type RealCost, realCostByDay, usdToInr } from "../_shared/openaiCosts.ts";

interface DailyRow {
  day: string; // YYYY-MM-DD, UTC
  userId: string | null;
  email: string | null;
  model: string;
  provider: string;
  calls: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

async function realCostFactors(rows: DailyRow[]): Promise<RealCost | null> {
  const estimateByDay = new Map<string, number>();
  for (const r of rows) estimateByDay.set(r.day, (estimateByDay.get(r.day) ?? 0) + r.estimatedCostUsd);
  return realCostByDay(estimateByDay);
}

function group(
  rows: (DailyRow & { costUsd: number })[],
  keyOf: (r: DailyRow) => string,
  pick: (r: DailyRow) => Record<string, unknown>,
) {
  const out = new Map<string, Record<string, unknown> & { calls: number; totalTokens: number; estimatedCostUsd: number }>();
  for (const r of rows) {
    const k = keyOf(r);
    const g = out.get(k) ?? { ...pick(r), calls: 0, totalTokens: 0, estimatedCostUsd: 0 };
    g.calls += r.calls;
    g.totalTokens += r.totalTokens;
    g.estimatedCostUsd += r.costUsd;
    out.set(k, g);
  }
  return [...out.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const client = getUserClient(req);
    const [summaryResult, dailyResult] = await Promise.all([
      client.rpc("admin_ai_usage_summary"),
      client.rpc("admin_ai_usage_daily"),
    ]);
    if (summaryResult.error) throwOnRpcError(summaryResult.error);
    if (dailyResult.error) throwOnRpcError(dailyResult.error);

    const rows = (dailyResult.data ?? []) as DailyRow[];
    const [real, inrRate] = await Promise.all([
      realCostFactors(rows).catch((err) => {
        // Fall back to estimates rather than failing the whole page.
        console.error("admin-ai-usage: real cost lookup failed", err);
        return null;
      }),
      usdToInr(),
    ]);

    const costed = rows.map((r) => ({
      ...r,
      costUsd: real ? r.estimatedCostUsd * (real.factorByDay.get(r.day) ?? 0) : r.estimatedCostUsd,
    }));

    const monthStart = dayKey(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1) / 1000);
    const sumCost = (list: typeof costed) => list.reduce((s, r) => s + r.costUsd, 0);

    return jsonResponse({
      ...summaryResult.data,
      costSource: real ? "openai" : "estimate",
      usdToInr: inrRate,
      estimatedCostUsd: real ? real.totalUsd : sumCost(costed),
      costThisMonthUsd: real ? real.thisMonthUsd : sumCost(costed.filter((r) => r.day >= monthStart)),
      unattributedCostUsd: real ? real.unattributedUsd : 0,
      byModel: group(costed, (r) => `${r.provider}/${r.model}`, (r) => ({ model: r.model, provider: r.provider })),
      byUser: group(costed.filter((r) => r.userId), (r) => r.userId!, (r) => ({ userId: r.userId, email: r.email ?? "(deleted user)" })).slice(0, 50),
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
});
