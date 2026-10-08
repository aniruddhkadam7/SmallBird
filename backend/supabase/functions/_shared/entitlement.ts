// Shared helper used by every proxy function: verifies the caller's Supabase
// auth token and loads their entitlement (plan + remaining minute balance)
// against the REAL project schema — public.entitlements / public.plans.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface Entitlement {
  admin: SupabaseClient;
  userId: string;
  planId: string;
  remainingMinutes: number;
  periodEnd: string | null;
  maxConcurrentSessions: number;
}

export class EntitlementError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/// Every caller of `requireEntitlement` has `verify_jwt = true` set in
/// `config.toml`, so the Supabase platform has already verified this JWT's
/// signature and expiry before the function even runs — a second
/// `auth.getUser(jwt)` round-trip to the Auth server here was pure duplicate
/// latency on every single request (this sits directly in front of the LLM
/// call in `llm-proxy`, so it was adding to the "thinking..." delay users see
/// on every question). Decoding the already-verified token locally to read
/// `sub` gets the same userId with no network call.
export function userIdFromVerifiedJwt(jwt: string): string {
  const payload = jwt.split(".")[1];
  if (!payload) throw new EntitlementError(401, "Malformed session token");
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
  try {
    const claims = JSON.parse(atob(base64));
    if (typeof claims.sub !== "string" || !claims.sub) throw new Error("no sub claim");
    return claims.sub;
  } catch {
    throw new EntitlementError(401, "Invalid session token");
  }
}

/// `allowDuringMaintenance` is only for the calls that close out and bill a
/// session already running (heartbeat, usage-report) — blocking those would
/// leave sessions unbilled. Everything that starts or powers a session
/// (stt-token, llm-proxy) is refused while maintenance mode is on.
export async function requireEntitlement(
  req: Request,
  { allowDuringMaintenance = false }: { allowDuringMaintenance?: boolean } = {},
): Promise<Entitlement> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) throw new EntitlementError(401, "Missing Authorization header");

  const userId = userIdFromVerifiedJwt(jwt);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  // Run entitlement, ban, and maintenance checks in parallel
  const [entResult, profileResult, maintenanceResult] = await Promise.all([
    admin
      .from("entitlements")
      .select("plan_id, remaining_minutes, period_end, plans(max_concurrent_sessions)")
      .eq("user_id", userId)
      .single(),
    admin
      .from("profiles")
      .select("is_banned, ban_reason")
      .eq("id", userId)
      .maybeSingle(),
    admin
      .from("app_settings")
      .select("key, value")
      .in("key", ["maintenance_mode", "maintenance_message"]),
  ]);

  // Maintenance takes priority over everything else
  const settingsMap = Object.fromEntries(
    (maintenanceResult.data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]),
  );
  if (settingsMap["maintenance_mode"] === "true" && !allowDuringMaintenance) {
    const msg = settingsMap["maintenance_message"] ?? "SmallBird is currently under maintenance. Please check back shortly.";
    throw new EntitlementError(503, msg, "MAINTENANCE");
  }

  // Ban check
  if (profileResult.data?.is_banned) {
    throw new EntitlementError(403, "Your account has been suspended. Please contact support.");
  }

  const { data: ent, error: entErr } = entResult;
  if (entErr || !ent) throw new EntitlementError(403, "No entitlement record for this user");

  if (ent.period_end && new Date(ent.period_end) < new Date()) {
    throw new EntitlementError(402, "Your plan has expired — please renew to continue");
  }

  return {
    admin,
    userId,
    planId: ent.plan_id,
    remainingMinutes: Number(ent.remaining_minutes),
    periodEnd: ent.period_end,
    // deno-lint-ignore no-explicit-any
    maxConcurrentSessions: (ent as any).plans?.max_concurrent_sessions ?? 1,
  };
}

export function entitlementErrorResponse(err: unknown): Response {
  if (err instanceof EntitlementError) {
    return new Response(JSON.stringify({ error: err.message, ...(err.code ? { code: err.code } : {}) }), {
      status: err.status,
      headers: { "content-type": "application/json" },
    });
  }
  console.error(err);
  return new Response(JSON.stringify({ error: "Internal error" }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });
}
