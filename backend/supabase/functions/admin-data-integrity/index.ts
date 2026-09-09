// Runs the data integrity check queries and returns them as actionable
// warnings. admin_data_integrity_checks() embeds its own admin check, so
// this is one Postgres round trip.

import { adminErrorResponse, getUserClient, handlePreflight, jsonResponse, throwOnRpcError } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const client = getUserClient(req);
    const { data, error } = await client.rpc("admin_data_integrity_checks");
    if (error) throwOnRpcError(error);

    return jsonResponse({ checks: data ?? [] });
  } catch (err) {
    return adminErrorResponse(err);
  }
});
