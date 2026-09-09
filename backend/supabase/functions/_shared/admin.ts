// Shared helper used by every admin-* function: verifies the caller's
// Supabase auth token, then checks them against the server-side admin_users
// allowlist (0016_admin_console_foundation.sql) using a service-role client.
// admin_users has zero RLS policies, so this table lookup is the ONLY way
// admin status is ever decided — there is no client-trustable "is_admin"
// flag anywhere. This check runs fresh on every single request; nothing
// about the frontend (middleware, cached state, UI) is ever treated as
// authoritative.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface AdminContext {
  admin: SupabaseClient;
  adminUserId: string;
  adminEmail: string;
  ip: string | null;
  userAgent: string | null;
}

export class AdminError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// The admin console's Server Components call these functions server-side
// (no browser involved, no CORS), but its Client Components (login,
// Grant/Remove minutes, Grant Pass, MFA) call them directly from the
// browser, which sends a CORS preflight OPTIONS request for any fetch()
// carrying a custom Authorization header. Every response — including the
// preflight itself and every error path — needs these headers, or the
// browser never even sends the real request. `*` is fine here: this app
// requires the caller's own Supabase JWT to do anything, so an open CORS
// origin doesn't widen access on its own.
export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Call this first in every admin-* function's Deno.serve, before anything
// else: `if (handled) return handled;`
export function handlePreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  return null;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

// For pure-read admin-* functions whose target RPC embeds its own admin
// check (current_admin_user_id(), 0023_admin_single_roundtrip_reads.sql):
// no network call here at all, just a local client construction carrying
// the caller's JWT — PostgREST verifies it (and the RPC enforces admin
// membership) when the actual query runs, so there's no separate
// pre-flight round trip like requireAdmin() below does.
export function getUserClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) throw new AdminError(401, "Missing Authorization header");

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

// current_admin_user_id() raises SQLSTATE 42501 (insufficient_privilege)
// for a non-admin caller, which PostgREST surfaces as error.code — map that
// to 403; anything else from that RPC means the JWT itself was rejected.
export function throwOnRpcError(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (error.code === "42501") throw new AdminError(403, "Not authorized");
  throw new AdminError(401, "Invalid or expired session");
}

export async function requireAdmin(req: Request): Promise<AdminContext> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) throw new AdminError(401, "Missing Authorization header");

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Single round trip instead of two: PostgREST verifies the JWT's
  // signature/expiry itself before invoking admin_whoami() (the same
  // mechanism every RLS policy in this project already relies on via
  // auth.uid()), so this one RPC call gets an equally-verified identity
  // that a manual userClient.auth.getUser(jwt) call to the Auth server
  // would — just without the extra hop. See 0022_admin_whoami_fast_path.sql.
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: rows, error: whoamiErr } = await userClient.rpc("admin_whoami");
  if (whoamiErr) {
    throw new AdminError(401, "Invalid or expired session");
  }
  if (!rows || rows.length === 0) {
    throw new AdminError(403, "Not authorized");
  }

  const admin = createClient(url, serviceKey);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = req.headers.get("user-agent");

  return {
    admin,
    adminUserId: rows[0].user_id,
    adminEmail: rows[0].email,
    ip,
    userAgent,
  };
}

export function adminErrorResponse(err: unknown): Response {
  if (err instanceof AdminError) {
    return jsonResponse({ error: err.message }, err.status);
  }
  console.error(err);
  return jsonResponse({ error: "Internal error" }, 500);
}
