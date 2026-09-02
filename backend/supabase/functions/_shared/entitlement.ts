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
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireEntitlement(req: Request): Promise<Entitlement> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) throw new EntitlementError(401, "Missing Authorization header");

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    throw new EntitlementError(401, "Invalid or expired session");
  }
  const userId = userData.user.id;

  const admin = createClient(url, serviceKey);

  const { data: ent, error: entErr } = await admin
    .from("entitlements")
    .select("plan_id, remaining_minutes, period_end, plans(max_concurrent_sessions)")
    .eq("user_id", userId)
    .single();
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
    return new Response(JSON.stringify({ error: err.message }), {
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
