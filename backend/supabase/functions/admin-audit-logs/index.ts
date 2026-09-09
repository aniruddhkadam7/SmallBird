// Paginated read of admin_audit_logs. Request body:
// { targetUserId?, adminUserId?, action?, limit?, offset? }.
// admin_list_audit_logs() embeds its own admin check, so this is one
// Postgres round trip.

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

    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
    const offset = Math.max(Number(body.offset) || 0, 0);

    const { data, error } = await client.rpc("admin_list_audit_logs", {
      p_target_user_id: typeof body.targetUserId === "string" ? body.targetUserId : null,
      p_admin_user_id: typeof body.adminUserId === "string" ? body.adminUserId : null,
      p_action: typeof body.action === "string" ? body.action : null,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throwOnRpcError(error);

    const totalCount = data?.[0]?.total_count ?? 0;

    return jsonResponse({ logs: data ?? [], totalCount, limit, offset });
  } catch (err) {
    return adminErrorResponse(err);
  }
});
