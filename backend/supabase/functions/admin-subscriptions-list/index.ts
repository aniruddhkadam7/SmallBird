// Paginated, filterable subscriptions list. Request body:
// { search?, status?, limit?, offset? }. admin_list_subscriptions() embeds
// its own admin check, so this is one Postgres round trip.

import { adminErrorResponse, getUserClient, handlePreflight, jsonResponse, throwOnRpcError } from "../_shared/admin.ts";

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
    const status = typeof body.status === "string" ? body.status : null;
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
    const offset = Math.max(Number(body.offset) || 0, 0);

    const { data, error } = await client.rpc("admin_list_subscriptions", {
      p_search: search,
      p_status: status,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throwOnRpcError(error);

    const totalCount = data?.[0]?.total_count ?? 0;

    return jsonResponse({ subscriptions: data ?? [], totalCount, limit, offset });
  } catch (err) {
    return adminErrorResponse(err);
  }
});
