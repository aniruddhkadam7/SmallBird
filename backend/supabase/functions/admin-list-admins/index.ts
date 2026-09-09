// Lists everyone on the admin allowlist. admin_list_all_admins() embeds its
// own admin check, so this is one Postgres round trip. Still read-only --
// there is deliberately no admin-add-admin function.

import { adminErrorResponse, getUserClient, handlePreflight, jsonResponse, throwOnRpcError } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const client = getUserClient(req);
    const { data, error } = await client.rpc("admin_list_all_admins");
    if (error) throwOnRpcError(error);

    return jsonResponse({ admins: data ?? [] });
  } catch (err) {
    return adminErrorResponse(err);
  }
});
