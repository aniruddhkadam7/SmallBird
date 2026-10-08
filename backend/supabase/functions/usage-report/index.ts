// Client calls this once an Interview Mode session ends, closing out the
// interview_sessions row and deducting the minutes used from the user's
// entitlement balance.
//
// Request body: { sessionId: string, actualDurationSeconds?: number }
//
// The minutes billed are measured by the server (session start -> now,
// capped at what was authorized) in end_and_bill_session — the client's
// actualDurationSeconds is still accepted for compatibility with installed
// apps but no longer trusted, since a modified client could report 1 second
// for an hour-long session. The session's Deepgram key is revoked here too,
// so it stops working the moment the session ends.

import { entitlementErrorResponse, requireEntitlement } from "../_shared/entitlement.ts";
import { withCors } from "../_shared/cors.ts";
import { revokeSessionKey } from "../_shared/deepgram.ts";

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const entitlement = await requireEntitlement(req, { allowDuringMaintenance: true });
    const { sessionId } = await req.json();

    if (typeof sessionId !== "string" || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
      return new Response(JSON.stringify({ error: "Invalid sessionId or actualDurationSeconds" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    // Claims the row at most once (active + not yet deducted, owned by the
    // caller), so the same session can never be billed twice; a session
    // already ended elsewhere (force-ended, expired) returns no row.
    const { data: ended, error: endErr } = await entitlement.admin.rpc("end_and_bill_session", {
      p_session_id: sessionId,
      p_user_id: entitlement.userId,
      p_status: "completed",
      p_reason: null,
    });
    if (endErr) throw endErr;

    const row = Array.isArray(ended) ? ended[0] : null;
    if (row) {
      await revokeSessionKey(entitlement.admin, sessionId, row.deepgram_key_id);
    }

    await entitlement.admin.from("usage_events").insert({
      user_id: entitlement.userId,
      event_name: "interview_session_completed",
      properties: { session_id: sessionId, minutes_consumed: row ? Number(row.minutes) : 0 },
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return entitlementErrorResponse(err);
  }
}));
