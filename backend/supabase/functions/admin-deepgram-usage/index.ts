// Deepgram (speech-to-text) balance and real spend, for the admin console's
// AI usage page. Balance comes straight from Deepgram; spend from the
// synced deepgram_request_costs table (see _shared/deepgramCosts.ts).

import { adminErrorResponse, handlePreflight, jsonResponse, requireAdmin } from "../_shared/admin.ts";
import { deepgramBalanceUsd, deepgramConfigured, syncDeepgramCosts } from "../_shared/deepgramCosts.ts";
import { usdToInr } from "../_shared/openaiCosts.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const ctx = await requireAdmin(req);
    if (!deepgramConfigured()) return jsonResponse({ configured: false });

    const [balanceUsd, inrRate] = await Promise.all([deepgramBalanceUsd(), usdToInr(), syncDeepgramCosts(ctx.admin)]);

    const { data: summary, error } = await ctx.admin.rpc("deepgram_cost_summary");
    if (error) throw error;

    return jsonResponse({ configured: true, balanceUsd, usdToInr: inrRate, ...summary });
  } catch (err) {
    return adminErrorResponse(err);
  }
});
