// Paginated transcript list for the admin console. Read-only -- there is no
// admin-transcript-delete function; interview_transcripts has DELETE
// revoked from anon/authenticated at the grant level (0015). Request body:
// { search?, userId?, limit?, offset? }. admin_list_transcripts() embeds
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
    const userId = typeof body.userId === "string" ? body.userId : null;
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
    const offset = Math.max(Number(body.offset) || 0, 0);

    const { data, error } = await client.rpc("admin_list_transcripts", {
      p_search: search,
      p_user_id: userId,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throwOnRpcError(error);

    const totalCount = data?.[0]?.total_count ?? 0;

    return jsonResponse({ transcripts: data ?? [], totalCount, limit, offset });
  } catch (err) {
    return adminErrorResponse(err);
  }
});
