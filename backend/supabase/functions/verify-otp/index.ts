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
import { withCors } from "../_shared/cors.ts";
import { allowRequest, clientIp } from "../_shared/ratelimit.ts";
import { recordDevice } from "../_shared/device.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const MAX_ATTEMPTS = 5;
// Failed guesses allowed per email across ALL its codes in 24h. With 9,000
// possible codes this keeps a determined attacker at ~0.2% success per day,
// while a real user never comes close.
const DAILY_ATTEMPT_BUDGET = 20;
const MAX_VERIFY_PER_IP = 30;
const IP_WINDOW_SECONDS = 15 * 60;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let email: string;
  let code: string;
  let name: string | null;
  try {
    const body = await req.json();
    email = String(body.email ?? "").trim().toLowerCase();
    code = String(body.code ?? "").trim();
    name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (!email || !code) return json({ error: "Missing email or code" }, 400);

  // Per-IP guess limit (spread across any number of emails), on top of the
  // per-code and per-email limits enforced atomically below.
  if (!(await allowRequest(admin, `otp-verify-ip:${clientIp(req)}`, MAX_VERIFY_PER_IP, IP_WINDOW_SECONDS))) {
    return json({ error: "Too many login attempts — please wait a few minutes and try again" }, 429);
  }

  // Claims this attempt atomically BEFORE comparing: the attempt counter is
  // incremented inside one serialized database call, so parallel guesses can
  // no longer all read "0 attempts used" and bypass MAX_ATTEMPTS (with only
  // 9,000 possible codes, that race allowed a full brute force in seconds).
  // A per-email daily failure budget also caps guessing across repeatedly
  // re-requested codes.
  const { data: claims, error: claimErr } = await admin.rpc("otp_claim_attempt", {
    p_email: email,
    p_max_attempts: MAX_ATTEMPTS,
    p_daily_budget: DAILY_ATTEMPT_BUDGET,
  });
  if (claimErr) {
    console.error("verify-otp: claim failed", claimErr);
    return json({ error: "Internal error" }, 500);
  }
  const claim = Array.isArray(claims) ? claims[0] : claims;
  if (!claim || claim.status === "locked") {
    return json({ error: "Too many incorrect attempts — please try again later" }, 429);
  }
  if (claim.status !== "ok") {
    // Same messages as before this change: distinguish "used up its tries"
    // from "expired / no code".
    const { data: latest } = await admin
      .from("login_otps")
      .select("attempts, expires_at")
      .eq("email", email)
      .eq("consumed", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest && latest.attempts >= MAX_ATTEMPTS && new Date(latest.expires_at) > new Date()) {
      return json({ error: "Too many incorrect attempts — request a new code" }, 429);
    }
    return json({ error: "Code expired or invalid — request a new one" }, 400);
  }

  const submittedHash = await sha256Hex(code);
  // Constant-time compare — this is a login gate, don't leak timing info.
  const a = submittedHash;
  const b = claim.code_hash as string;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  if (diff !== 0) {
    return json({ error: "Incorrect code" }, 400);
  }

  // Exactly-once: a second, simultaneous correct submission gets nothing.
  const { data: consumed, error: consumeErr } = await admin.rpc("otp_consume", { p_otp_id: claim.otp_id });
  if (consumeErr || consumed !== true) {
    return json({ error: "Code expired or invalid — request a new one" }, 400);
  }

  // `options.data` only seeds user_metadata for a brand-new user (same as
  // signUp) — it's ignored here if this email already has an account, which
  // is why an existing account with no name yet gets backfilled explicitly
  // below once we know its user id.
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: name ? { data: { full_name: name } } : undefined,
  });
  if (linkErr || !linkData) {
    console.error("verify-otp: generateLink failed", linkErr);
    return json({ error: "Internal error" }, 500);
  }
  const tokenHash = linkData.properties.hashed_token;

  if (name && !linkData.user?.user_metadata?.full_name) {
    const { error: updateErr } = await admin.auth.admin.updateUserById(linkData.user.id, {
      user_metadata: { ...linkData.user.user_metadata, full_name: name },
    });
    if (updateErr) console.error("verify-otp: full_name backfill failed", updateErr);
  }

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
  await recordDevice(admin, req, linkData.user.id, "sign_in");
  return json(session);
}));
