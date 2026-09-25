// Revokes the Deepgram keys of sessions that have ended but whose key wasn't
// revoked yet — sessions that expired (app crashed / killed / offline, so
// usage-report never ran) and any revocation that failed the first time.
// Without this, a session's key would keep working for its full TTL (up to
// 4 hours) after the session ended.
//
// Called every minute by pg_cron via pg_net (see migration 0032). Safe to be
// called by anyone: it only ever revokes keys of sessions that have already
// ended, and does a bounded amount of work per call.

import { createClient } from "npm:@supabase/supabase-js@2";
import { withCors } from "../_shared/cors.ts";
import { revokeSessionKey } from "../_shared/deepgram.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const BATCH = 50;
// An "expired" session is one that missed heartbeats for 2 minutes; give it a
// few more before revoking, so a brief network drop never costs a working key
// any sooner than the app itself would notice the session ended.
const EXPIRED_GRACE_MS = 5 * 60 * 1000;

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const { data: rows, error } = await admin
    .from("interview_sessions")
    .select("id, status, ended_at, deepgram_key_id")
    .neq("status", "active")
    .not("deepgram_key_id", "is", null)
    .is("deepgram_key_revoked_at", null)
    .order("ended_at", { ascending: true })
    .limit(BATCH);
  if (error) {
    console.error("session-janitor: lookup failed", error);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: { "content-type": "application/json" } });
  }

  const now = Date.now();
  let revoked = 0;
  for (const row of rows ?? []) {
    if (row.status === "expired" && row.ended_at && now - new Date(row.ended_at).getTime() < EXPIRED_GRACE_MS) continue;
    await revokeSessionKey(admin, row.id, row.deepgram_key_id);
    revoked++;
  }

  return new Response(JSON.stringify({ ok: true, checked: rows?.length ?? 0, revoked }), {
    headers: { "content-type": "application/json" },
  });
}));
