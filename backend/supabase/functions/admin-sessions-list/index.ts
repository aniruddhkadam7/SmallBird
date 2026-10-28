// Paginated, filterable interview session list. Request body:
// { search?, status?, dateFrom?, dateTo?, suspiciousOnly?, limit?, offset? }.
// admin_list_sessions() embeds its own admin check, so this is one Postgres
// round trip.

import { adminErrorResponse, getUserClient, handlePreflight, jsonResponse, throwOnRpcError } from "../_shared/admin.ts";

// "failed" = ended early or timed out (terminated or expired).
const VALID_STATUSES = new Set(["active", "completed", "expired", "terminated", "failed"]);
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
    const status = typeof body.status === "string" && VALID_STATUSES.has(body.status) ? body.status : null;
    const dateFrom = typeof body.dateFrom === "string" ? body.dateFrom : null;
    const dateTo = typeof body.dateTo === "string" ? body.dateTo : null;
    const suspiciousOnly = body.suspiciousOnly === true;
    const period = PERIODS.has(body.period) ? body.period : null;
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
    const offset = Math.max(Number(body.offset) || 0, 0);

    const { data, error } = await client.rpc("admin_list_sessions", {
      p_search: search,
      p_status: status,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_suspicious_only: suspiciousOnly,
      p_limit: limit,
      p_offset: offset,
      p_period: period,
    });
    if (error) throwOnRpcError(error);

    const totalCount = data?.[0]?.total_count ?? 0;

    return jsonResponse({ sessions: data ?? [], totalCount, limit, offset });
  } catch (err) {
    return adminErrorResponse(err);
  }
});
