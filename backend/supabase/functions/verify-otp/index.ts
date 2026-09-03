// Verifies a 4-digit login code issued by ../request-otp and mints a real
// Supabase session for it — the client never talks to /auth/v1/otp or
// /auth/v1/verify directly for this flow (see public.login_otps).
//
// Called by the desktop app's verify_login_otp Tauri command
// (src-tauri/src/auth/client.rs) in place of POST /auth/v1/verify.
//
// Session minting works by generating a Supabase magic-link token
// server-side (admin.generateLink, which also creates the user if this is
// their first sign-in — same "no separate signup step" behavior the old
// create_user:true OTP call had) and then redeeming that token_hash through
// the public verify endpoint. The 4-digit code the user typed never touches
// Supabase Auth itself; it only gates whether we're willing to do that.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const MAX_ATTEMPTS = 5;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let email: string;
  let code: string;
  try {
    const body = await req.json();
    email = String(body.email ?? "").trim().toLowerCase();
    code = String(body.code ?? "").trim();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (!email || !code) return json({ error: "Missing email or code" }, 400);

  const { data: row, error: fetchErr } = await admin
    .from("login_otps")
    .select("id, code_hash, attempts, expires_at, consumed")
    .eq("email", email)
    .eq("consumed", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchErr) {
    console.error("verify-otp: lookup failed", fetchErr);
    return json({ error: "Internal error" }, 500);
  }
  if (!row || new Date(row.expires_at) < new Date()) {
    return json({ error: "Code expired or invalid — request a new one" }, 400);
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    return json({ error: "Too many incorrect attempts — request a new code" }, 429);
  }

  const submittedHash = await sha256Hex(code);
  // Constant-time compare — this is a login gate, don't leak timing info.
  const a = submittedHash;
  const b = row.code_hash;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  if (diff !== 0) {
    await admin.from("login_otps").update({ attempts: row.attempts + 1 }).eq("id", row.id);
    return json({ error: "Incorrect code" }, 400);
  }

  await admin.from("login_otps").update({ consumed: true }).eq("id", row.id);

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr || !linkData) {
    console.error("verify-otp: generateLink failed", linkErr);
    return json({ error: "Internal error" }, 500);
  }
  const tokenHash = linkData.properties.hashed_token;

  const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: tokenHash }),
  });
  if (!verifyRes.ok) {
    console.error("verify-otp: session mint failed", verifyRes.status, await verifyRes.text());
    return json({ error: "Internal error" }, 500);
  }

  const session = await verifyRes.json();
  return json(session);
});
