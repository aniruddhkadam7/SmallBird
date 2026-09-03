// Client pings this every ~30-90s while an interview session is active, so a
// crashed app (which never calls usage-report) doesn't leave a permanently
// "active" row blocking the one-active-session-per-user unique index.
// A separate scheduled job (see backend/README.md) sweeps sessions whose
// last_heartbeat_at is stale and marks them "expired".
//
// This is also how a device finds out its session was force-ended by a new
// login elsewhere (see stt-token's `force` option): the update below only
// matches rows still `status = 'active'`, so once another device has ended
// this one, the update matches nothing and the response tells the caller
// exactly that, distinct from an unrelated 404/network failure.
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

    const { data, error } = await entitlement.admin
      .from("interview_sessions")
      .update({ last_heartbeat_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("user_id", entitlement.userId)
      .eq("status", "active")
      .select("id, termination_reason");

    if (error) throw error;

    if (!data || data.length === 0) {
      const { data: row } = await entitlement.admin
        .from("interview_sessions")
        .select("termination_reason")
        .eq("id", sessionId)
        .single();

      const endedByNewLogin = row?.termination_reason === "force_ended_by_new_login";
      return new Response(
        JSON.stringify({
          error: endedByNewLogin
            ? "This session was ended because your account was used to start a new session elsewhere."
            : "This session has already ended.",
          code: "SESSION_ENDED",
        }),
        { status: 410, headers: { "content-type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return entitlementErrorResponse(err);
  }
});
