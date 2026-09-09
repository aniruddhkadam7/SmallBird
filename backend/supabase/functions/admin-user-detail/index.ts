// Full detail payload for one user's admin profile page. Request body:
// { userId: string }. admin_user_detail() embeds its own admin check, so
// this is one Postgres round trip.

import { adminErrorResponse, getUserClient, handlePreflight, jsonResponse, throwOnRpcError } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const client = getUserClient(req);
    const { userId } = await req.json();

    if (typeof userId !== "string") {
      return jsonResponse({ error: "Invalid userId" }, 400);
    }

    const { data, error } = await client.rpc("admin_user_detail", { p_user_id: userId });
    if (error) throwOnRpcError(error);

    if (!data?.profile) {
      return jsonResponse({ error: "User not found" }, 404);
    }

    return jsonResponse(data);
  } catch (err) {
    return adminErrorResponse(err);
  }
});
