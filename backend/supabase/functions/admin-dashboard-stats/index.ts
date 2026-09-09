// Overview stats for the admin dashboard. admin_dashboard_stats() embeds
// its own admin check (current_admin_user_id()), so this is a single
// Postgres round trip per request -- no separate pre-flight auth call.
// See 0023_admin_single_roundtrip_reads.sql.

import { adminErrorResponse, getUserClient, handlePreflight, jsonResponse, throwOnRpcError } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const client = getUserClient(req);
    const { data, error } = await client.rpc("admin_dashboard_stats");
    if (error) throwOnRpcError(error);

    return jsonResponse(data);
  } catch (err) {
    return adminErrorResponse(err);
  }
});
