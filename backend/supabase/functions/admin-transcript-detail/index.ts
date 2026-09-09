// Full transcript content (all turns) for one interview. Request body:
// { transcriptId: string }. admin_transcript_detail() embeds its own admin
// check, so this is one Postgres round trip.

import { adminErrorResponse, getUserClient, handlePreflight, jsonResponse, throwOnRpcError } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const client = getUserClient(req);
    const { transcriptId } = await req.json();

    if (typeof transcriptId !== "string") {
      return jsonResponse({ error: "Invalid transcriptId" }, 400);
    }

    const { data, error } = await client.rpc("admin_transcript_detail", { p_transcript_id: transcriptId });
    if (error) throwOnRpcError(error);

    if (!data) {
      return jsonResponse({ error: "Transcript not found" }, 404);
    }

    return jsonResponse(data);
  } catch (err) {
    return adminErrorResponse(err);
  }
});
