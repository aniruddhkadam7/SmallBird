// Rate limiting backed by public.rate_limit_hits (see migration 0031): one
// row per request in a named bucket, counted over a sliding window inside a
// per-bucket lock so parallel requests can't all slip under the limit.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/// Records a hit and returns whether it's within `limit` per `windowSeconds`.
/// Fails OPEN on a database error — a rate-limit hiccup must never block a
/// real user mid-interview; the other safeguards still apply.
export async function allowRequest(
  admin: SupabaseClient,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const { data, error } = await admin.rpc("rate_limit_hit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("rate_limit_hit failed (allowing request)", bucket, error);
    return true;
  }
  return data === true;
}

/// The caller's IP as seen by the Supabase edge (first X-Forwarded-For hop).
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || "unknown";
}
