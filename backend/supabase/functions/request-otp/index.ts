// Issues a 4-digit login code (Supabase's built-in email OTP is fixed at
// 6+ digits with no length setting, so this replaces it — see
// public.login_otps and ../verify-otp).
//
// Called by the desktop app's request_login_otp Tauri command
// (src-tauri/src/auth/client.rs) in place of POST /auth/v1/otp.

import { createClient } from "npm:@supabase/supabase-js@2";
import { withCors } from "../_shared/cors.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_ADDRESS = "SmallBird <noreply@smallbird.in>";

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 5;
const REQUEST_WINDOW_MS = 15 * 60 * 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateCode(): string {
  // Rejection-sample so all 9000 four-digit codes (1000-9999) are equally
  // likely — a plain modulo would bias toward smaller codes.
  const range = 9000;
  const maxUsable = Math.floor(65536 / range) * range;
  let n: number;
  do {
    n = crypto.getRandomValues(new Uint16Array(1))[0];
  } while (n >= maxUsable);
  return String(1000 + (n % range));
}

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let email: string;
  try {
    const body = await req.json();
    email = String(body.email ?? "").trim().toLowerCase();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (!EMAIL_RE.test(email)) return json({ error: "Invalid email address" }, 400);

  const windowStart = new Date(Date.now() - REQUEST_WINDOW_MS).toISOString();
  const { count, error: countErr } = await admin
    .from("login_otps")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", windowStart);
  if (countErr) {
    console.error("request-otp: rate-limit lookup failed", countErr);
    return json({ error: "Internal error" }, 500);
  }
  if ((count ?? 0) >= MAX_REQUESTS_PER_WINDOW) {
    return json({ error: "Too many login attempts — please wait a few minutes and try again" }, 429);
  }

  const code = generateCode();
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  const { error: insertErr } = await admin.from("login_otps").insert({ email, code_hash: codeHash, expires_at: expiresAt });
  if (insertErr) {
    console.error("request-otp: insert failed", insertErr);
    return json({ error: "Internal error" }, 500);
  }

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: email,
      subject: "Your sign-in code",
      html: `<p>Your Smallbird sign-in code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>This code expires in 5 minutes and can only be used once.</p>`,
    }),
  });
  if (!emailRes.ok) {
    console.error("request-otp: Resend send failed", emailRes.status, await emailRes.text());
    return json({ error: "Failed to send login email" }, 502);
  }

  return json({ ok: true });
}));
