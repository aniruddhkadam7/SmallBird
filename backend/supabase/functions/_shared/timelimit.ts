// A session may only run for its authorized time (the balance it started
// with, capped at 4h — see stt-token). Used by the AI proxies so an
// over-time session gets no more answers even if its app stops sending
// heartbeats; session-heartbeat enforces the same limit on its own.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { revokeSessionKey } from "./deepgram.ts";

export const TIME_UP_MESSAGE = "You've used all your minutes, so this session has ended. Top up to keep going.";

/// Ends (and bills, and revokes the speech key of) the user's active
/// session if its time is up. Returns whether it was.
export async function endSessionIfTimeUp(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data: session } = await admin
    .from("interview_sessions")
    .select("id, started_at, authorized_max_duration_seconds")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!session) return false;
  if (Date.now() - new Date(session.started_at).getTime() < session.authorized_max_duration_seconds * 1000) {
    return false;
  }
  const { data: ended, error } = await admin.rpc("end_and_bill_session", {
    p_session_id: session.id,
    p_user_id: userId,
    p_status: "completed",
    p_reason: "time_limit_reached",
  });
  if (error) {
    console.error("endSessionIfTimeUp: end_and_bill_session failed", error);
    return true;
  }
  const row = Array.isArray(ended) ? ended[0] : null;
  if (row) await revokeSessionKey(admin, session.id, row.deepgram_key_id);
  return true;
}
