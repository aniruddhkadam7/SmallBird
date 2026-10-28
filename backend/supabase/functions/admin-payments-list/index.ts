// Payment -> webhook -> entitlement trace for investigating purchases.
// Request body: { search?, period?: "today" | "week" | "month", limit?,
// offset? }. admin_list_payments() embeds its own admin check, so this is one
// Postgres round trip.

import { adminErrorResponse, getUserClient, handlePreflight, jsonResponse, throwOnRpcError } from "../_shared/admin.ts";

const PERIODS = new Set(["today", "week", "month"]);

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const client = getUserClient(req);
    const body = await req.json().catch(() => ({}));

    const search = typeof body.search === "string" && body.search.trim() ? body.search.trim() : null;
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
    const offset = Math.max(Number(body.offset) || 0, 0);
    const period = PERIODS.has(body.period) ? body.period : null;

    const { data, error } = await client.rpc("admin_list_payments", {
      p_search: search,
      p_limit: limit,
      p_offset: offset,
      p_period: period,
    });
    if (error) throwOnRpcError(error);

    const totalCount = data?.[0]?.total_count ?? 0;
    // Money and payments across every matching row, not just this page.
    const totalPaise = Number(data?.[0]?.total_paise ?? 0);
    const paymentCount = Number(data?.[0]?.payment_count ?? 0);

    return jsonResponse({ payments: data ?? [], totalCount, totalPaise, paymentCount, limit, offset });
  } catch (err) {
    return adminErrorResponse(err);
  }
});
