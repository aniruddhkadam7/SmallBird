// Returns all app_settings rows and api_key_store rows (masked) for the
// admin console Settings page. Both RPCs embed their own admin check via
// current_admin_user_id(), so this is just two parallel DB calls.

import { adminErrorResponse, getUserClient, handlePreflight, jsonResponse, throwOnRpcError } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const client = getUserClient(req);

    const [settingsResult, keysResult] = await Promise.all([
      client.rpc("admin_get_app_settings"),
      client.rpc("admin_get_api_keys"),
    ]);

    if (settingsResult.error) throwOnRpcError(settingsResult.error);
    if (keysResult.error) throwOnRpcError(keysResult.error);

    return jsonResponse({
      settings: settingsResult.data ?? {},
      apiKeys: keysResult.data ?? [],
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
});
