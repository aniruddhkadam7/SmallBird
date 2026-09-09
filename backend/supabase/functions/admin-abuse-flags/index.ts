// Surfaces abuse/anomaly flags for human investigation. Deliberately never
// takes any automatic action (ban, suspend, revoke) -- it only reports.
// admin_abuse_flags() embeds its own admin check, so this is one Postgres
// round trip.

import { adminErrorResponse, getUserClient, handlePreflight, jsonResponse, throwOnRpcError } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const client = getUserClient(req);
    const { data, error } = await client.rpc("admin_abuse_flags");
    if (error) throwOnRpcError(error);

    return jsonResponse({ flags: data ?? [] });
  } catch (err) {
    return adminErrorResponse(err);
  }
});
