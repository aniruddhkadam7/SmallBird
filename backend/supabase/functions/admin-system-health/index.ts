// Operational health signals derived from data already in the schema (no
// error-log table exists yet -- see the README). admin_system_health()
// embeds its own admin check, so this is one Postgres round trip.

import { adminErrorResponse, getUserClient, handlePreflight, jsonResponse, throwOnRpcError } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const client = getUserClient(req);
    const { data, error } = await client.rpc("admin_system_health");
    if (error) throwOnRpcError(error);

    return jsonResponse(data);
  } catch (err) {
    return adminErrorResponse(err);
  }
});
