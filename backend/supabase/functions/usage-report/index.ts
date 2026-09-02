// Client calls this once an Interview Mode session ends, closing out the
// interview_sessions row and deducting the actual minutes used from the
// user's entitlement balance.
//
// Request body: { sessionId: string, actualDurationSeconds: number }

import { entitlementErrorResponse, requireEntitlement } from "../_shared/entitlement.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const entitlement = await requireEntitlement(req);
    const { sessionId, actualDurationSeconds } = await req.json();

    if (typeof sessionId !== "string" || typeof actualDurationSeconds !== "number" || actualDurationSeconds <= 0) {
      return new Response(JSON.stringify({ error: "Invalid sessionId or actualDurationSeconds" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const minutesConsumed = actualDurationSeconds / 60;

    const { error: updateErr } = await entitlement.admin
      .from("interview_sessions")
      .update({
        status: "completed",
        ended_at: new Date().toISOString(),
        actual_duration_seconds: Math.round(actualDurationSeconds),
        minutes_consumed: minutesConsumed,
      })
      .eq("id", sessionId)
      .eq("user_id", entitlement.userId) // belt-and-suspenders alongside RLS
      .eq("status", "active");

    if (updateErr) throw updateErr;

    await entitlement.admin.rpc("decrement_entitlement_minutes", {
      p_user_id: entitlement.userId,
      p_minutes: minutesConsumed,
    });

    await entitlement.admin.from("usage_events").insert({
      user_id: entitlement.userId,
      event_name: "interview_session_completed",
      properties: { session_id: sessionId, minutes_consumed: minutesConsumed },
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return entitlementErrorResponse(err);
  }
});
