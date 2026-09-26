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
import { withCors } from "../_shared/cors.ts";
import { revokeSessionKey } from "../_shared/deepgram.ts";

/// Shown in the app when a session is ended because its time ran out.
const TIME_UP_MESSAGE = "You've used all your minutes, so this session has ended. Top up to keep going.";

Deno.serve(withCors(async (req) => {
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

    // The session's time is up (its authorized duration — the balance it
    // started with, capped at 4h — has passed): end and bill it here and
    // revoke its speech key. The app ends the session when it gets this
    // reply (every version handles SESSION_ENDED), so a session can't run
    // past the user's minutes by more than one heartbeat interval.
    const { data: current } = await entitlement.admin
      .from("interview_sessions")
      .select("started_at, authorized_max_duration_seconds, status")
      .eq("id", sessionId)
      .eq("user_id", entitlement.userId)
      .maybeSingle();
    if (
      current?.status === "active" &&
      Date.now() - new Date(current.started_at).getTime() >= current.authorized_max_duration_seconds * 1000
    ) {
      const { data: ended, error: endErr } = await entitlement.admin.rpc("end_and_bill_session", {
        p_session_id: sessionId,
        p_user_id: entitlement.userId,
        p_status: "completed",
        p_reason: "time_limit_reached",
      });
      if (endErr) throw endErr;
      const row = Array.isArray(ended) ? ended[0] : null;
      if (row) await revokeSessionKey(entitlement.admin, sessionId, row.deepgram_key_id);
      return new Response(JSON.stringify({ error: TIME_UP_MESSAGE, code: "SESSION_ENDED" }), {
        status: 410,
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
      const endedByTimeLimit = row?.termination_reason === "time_limit_reached";
      return new Response(
        JSON.stringify({
          error: endedByNewLogin
            ? "This session was ended because your account was used to start a new session elsewhere."
            : endedByTimeLimit
              ? TIME_UP_MESSAGE
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
}));
