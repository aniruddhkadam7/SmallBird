// Starts an interview session and mints a short-lived, scoped Deepgram key
// for the client to stream audio directly to Deepgram (no audio relay
// through our server). The session row is what the DB's unique partial
// index (interview_sessions_one_active_per_user) uses to block a second
// concurrent session for the same user.
//
// Request body: { force?: boolean } — when true and an active session
// already exists for this user, that session is marked "terminated" and a
// new one starts in its place, instead of failing with 409. The device that
// held the old session finds out via session-heartbeat (see that function's
// doc comment) rather than being left silently hanging.

import { entitlementErrorResponse, requireEntitlement } from "../_shared/entitlement.ts";

const MAX_SESSION_SECONDS = 3600; // hard ceiling regardless of balance

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const entitlement = await requireEntitlement(req);
    const { force } = await req.json().catch(() => ({ force: false }));

    if (entitlement.remainingMinutes <= 0) {
      return new Response(
        JSON.stringify({ error: "You're out of minutes. Upgrade or buy more to continue." }),
        { status: 402, headers: { "content-type": "application/json" } },
      );
    }

    const authorizedSeconds = Math.min(
      Math.floor(entitlement.remainingMinutes * 60),
      MAX_SESSION_SECONDS,
    );

    const insertSession = () =>
      entitlement.admin
        .from("interview_sessions")
        .insert({
          user_id: entitlement.userId,
          plan_id: entitlement.planId,
          authorized_max_duration_seconds: authorizedSeconds,
          stt_mode: "cloud",
          cloud_stt_provider: "deepgram",
          status: "active",
        })
        .select("id")
        .single();

    let { data: session, error: sessionErr } = await insertSession();

    if (sessionErr?.code === "23505") {
      // Unique violation on interview_sessions_one_active_per_user.
      if (!force) {
        return new Response(
          JSON.stringify({
            error: "You already have an active session on another device.",
            code: "ACTIVE_SESSION_ELSEWHERE",
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      }

      // Force: end the other session, then retry the insert now that the
      // unique slot is free. The other device's next heartbeat call will
      // see its row is no longer "active" and surface this to that user.
      await entitlement.admin
        .from("interview_sessions")
        .update({ status: "terminated", termination_reason: "force_ended_by_new_login", ended_at: new Date().toISOString() })
        .eq("user_id", entitlement.userId)
        .eq("status", "active");

      ({ data: session, error: sessionErr } = await insertSession());
    }

    if (sessionErr || !session) {
      throw sessionErr ?? new Error("Failed to create interview session");
    }

    const projectId = Deno.env.get("DEEPGRAM_PROJECT_ID")!;
    const managementKey = Deno.env.get("DEEPGRAM_API_KEY")!;

    const dgResp = await fetch(`https://api.deepgram.com/v1/projects/${projectId}/keys`, {
      method: "POST",
      headers: {
        Authorization: `Token ${managementKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        comment: `smallbird-session-${session.id}`,
        scopes: ["usage:write"],
        time_to_live_in_seconds: authorizedSeconds,
      }),
    });

    if (!dgResp.ok) {
      const text = await dgResp.text();
      console.error("Deepgram key mint failed", dgResp.status, text);
      // Roll back the session row so it doesn't block future attempts.
      await entitlement.admin.from("interview_sessions").update({
        status: "terminated",
        termination_reason: "deepgram_key_mint_failed",
        ended_at: new Date().toISOString(),
      }).eq("id", session.id);
      return new Response(JSON.stringify({ error: "Could not start transcription session" }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }

    const dgKey = await dgResp.json();

    return new Response(
      JSON.stringify({ sessionId: session.id, key: dgKey.key, expiresInSeconds: authorizedSeconds }),
      { headers: { "content-type": "application/json" } },
    );
  } catch (err) {
    return entitlementErrorResponse(err);
  }
});
