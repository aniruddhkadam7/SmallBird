// Deepgram key revocation, shared by usage-report, stt-token (force-ending a
// session elsewhere) and session-janitor. A session's key is only ever
// revoked once that session has ENDED — never during it: the desktop app
// reconnects mid-session with the same key after a network blip, so a live
// interview must keep a working key for as long as it runs.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/// Deletes the key at Deepgram. A 404 means it's already gone (expired or
/// revoked earlier) — that counts as revoked. Returns whether it's now gone.
export async function revokeDeepgramKey(keyId: string): Promise<boolean> {
  const projectId = Deno.env.get("DEEPGRAM_PROJECT_ID");
  const managementKey = Deno.env.get("DEEPGRAM_API_KEY");
  if (!projectId || !managementKey) return false;
  try {
    const res = await fetch(`https://api.deepgram.com/v1/projects/${projectId}/keys/${encodeURIComponent(keyId)}`, {
      method: "DELETE",
      headers: { Authorization: `Token ${managementKey}` },
    });
    if (res.ok || res.status === 404) return true;
    console.error("Deepgram key revoke failed", res.status, await res.text());
    return false;
  } catch (err) {
    console.error("Deepgram key revoke threw", err);
    return false;
  }
}

/// Revokes an ended session's key and records it. Best-effort: anything not
/// revoked here is retried by the session-janitor.
export async function revokeSessionKey(admin: SupabaseClient, sessionId: string, keyId: string | null | undefined) {
  if (!keyId) return;
  if (await revokeDeepgramKey(keyId)) {
    await admin
      .from("interview_sessions")
      .update({ deepgram_key_revoked_at: new Date().toISOString() })
      .eq("id", sessionId);
  }
}
