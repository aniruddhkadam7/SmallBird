// Mints a one-time magic-link token so the desktop app's "Open Dashboard"
// button (see interview_mode/commands.rs's open_dashboard) can sign the
// browser in too, instead of showing the website's own login screen for a
// session the user already has on the desktop app. The browser redeems the
// token at the website's /auth/handoff route (SmallBird-website).
//
// Deliberately not entitlement-gated (unlike stt-token/llm-proxy/etc.) — a
// user out of minutes should still be able to reach their dashboard to see
// past transcripts or buy more, not get stuck behind an entitlement check
// meant for metered AI/STT usage.
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userData?.user?.email) {
    return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const admin = createClient(url, serviceKey);
  // A magic-link OTP is single-use and short-lived by Supabase's own design
  // (GoTrue's OTP expiry) — exactly the properties a one-time cross-app
  // handoff needs, without a bespoke token table of our own to expire/clean
  // up. generateLink mints one without actually emailing it anywhere.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: userData.user.email,
  });

  if (linkErr || !link?.properties?.hashed_token) {
    console.error("dashboard-handoff: generateLink failed", linkErr);
    return new Response(JSON.stringify({ error: "Could not create handoff link" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ tokenHash: link.properties.hashed_token }), {
    headers: { "content-type": "application/json" },
  });
});
