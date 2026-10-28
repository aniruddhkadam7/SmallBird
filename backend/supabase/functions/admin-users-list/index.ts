// Paginated, filterable user list for the admin console's Users table.
// Request body: { search?, planFilter?: "free" | "paid", suspiciousOnly?,
// clientFilter?: "desktop" | "browser" | "website" | "none", segment?,
// limit?, offset? }. admin_list_users() embeds its own admin check, so this
// is one Postgres round trip.

import { adminErrorResponse, getUserClient, handlePreflight, jsonResponse, throwOnRpcError } from "../_shared/admin.ts";

// What a Home card counted -- see admin_list_users' p_segment.
const SEGMENTS = new Set([
  "joined_today", "joined_week", "joined_month", "active_7d", "interviewed", "never_interviewed",
  "desktop_windows", "desktop_mac", "android", "ios", "computer_browser", "website_only",
]);

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
    const planFilter = body.planFilter === "free" || body.planFilter === "paid" ? body.planFilter : null;
    const suspiciousOnly = body.suspiciousOnly === true;
    const clientFilter = ["desktop", "browser", "website", "none"].includes(body.clientFilter) ? body.clientFilter : null;
    const segment = SEGMENTS.has(body.segment) ? body.segment : null;
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
    const offset = Math.max(Number(body.offset) || 0, 0);

    const { data, error } = await client.rpc("admin_list_users", {
      p_search: search,
      p_plan_filter: planFilter,
      p_suspicious_only: suspiciousOnly,
      p_limit: limit,
      p_offset: offset,
      p_client_filter: clientFilter,
      p_segment: segment,
    });
    if (error) throwOnRpcError(error);

    const totalCount = data?.[0]?.total_count ?? 0;

    return jsonResponse({ users: data ?? [], totalCount, limit, offset });
  } catch (err) {
    return adminErrorResponse(err);
  }
});
