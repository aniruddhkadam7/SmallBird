// Client pings this every ~30s while an interview session is active, so a
// crashed app (which never calls usage-report) doesn't leave a permanently
// "active" row blocking the one-active-session-per-user unique index.
// A separate scheduled job (see backend/README.md) sweeps sessions whose
// last_heartbeat_at is stale and marks them "expired".
//
// Request body: { sessionId: string }

import { entitlementErrorResponse, requireEntitlement } from "../_shared/entitlement.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const entitlement = await requireEntitlement(req);
    const { sessionId } = await req.json();
    if (typeof sessionId !== "string") {
      return new Response(JSON.stringify({ error: "Invalid sessionId" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const { error } = await entitlement.admin
      .from("interview_sessions")
      .update({ last_heartbeat_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("user_id", entitlement.userId)
      .eq("status", "active");

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return entitlementErrorResponse(err);
  }
});
