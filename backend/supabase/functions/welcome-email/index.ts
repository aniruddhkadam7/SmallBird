// Sends the one-time "download the app" email to users who signed up but
// haven't opened the desktop app or done an interview yet (see
// welcome_email_candidates() in 0040_welcome_emails.sql).
//
// Called every 20 seconds by pg_cron via pg_net, so a new user gets it
// within about half a minute of signing up (0042_welcome_email_instant.sql). Safe to be called by anyone: it
// only ever emails due users, and each user at most once -- the
// welcome_emails row is claimed before sending, so two overlapping runs
// can't both send to the same person.

import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

const FROM_ADDRESS = "Smallbird Support <support@smallbird.in>";
const SUBJECT = "Clear any interview with your AI interview copilot";
const DOWNLOAD_URL = "https://github.com/aniruddhkadam7/SmallBird-releases/releases/latest/download/Smallbird-Setup.exe";
const BATCH = 50;
// Resend's default limit is 2 requests a second.
const SEND_GAP_MS = 600;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  if (!first) return null;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function emailHtml(name: string | null): string {
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi there,";
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;padding:32px;">
        <tr><td style="font-size:20px;font-weight:700;padding-bottom:20px;">Smallbird</td></tr>
        <tr><td style="font-size:16px;line-height:1.5;padding-bottom:8px;">${greeting}</td></tr>
        <tr><td style="font-size:16px;line-height:1.5;padding-bottom:24px;">
          Your Smallbird account is ready. Download the app and get real-time answers in your next interview.
        </td></tr>
        <tr><td align="center" style="padding-bottom:28px;">
          <a href="${DOWNLOAD_URL}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 28px;border-radius:8px;">Download for Windows</a>
        </td></tr>
        <tr><td style="font-size:15px;line-height:1.7;padding-bottom:24px;">
          1. Install and sign in with this email.<br>
          2. Join your interview on Zoom, Meet or Teams.<br>
          3. See clear answers on screen in seconds. Hidden during screen share.
        </td></tr>
        <tr><td style="font-size:15px;line-height:1.5;color:#555555;padding-bottom:4px;">Need help? Just reply to this email.</td></tr>
        <tr><td style="font-size:15px;line-height:1.5;color:#555555;">Team Smallbird</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function emailText(name: string | null): string {
  return `${name ? `Hi ${name},` : "Hi there,"}

Your Smallbird account is ready. Download the app and get real-time answers in your next interview.

Download for Windows: ${DOWNLOAD_URL}

1. Install and sign in with this email.
2. Join your interview on Zoom, Meet or Teams.
3. See clear answers on screen in seconds. Hidden during screen share.

Need help? Just reply to this email.

Team Smallbird`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const { data: candidates, error } = await admin.rpc("welcome_email_candidates", { p_limit: BATCH });
  if (error) {
    console.error("welcome-email: candidate lookup failed", error);
    return json({ error: "Internal error" }, 500);
  }

  let sent = 0;
  let failed = 0;
  for (const user of candidates ?? []) {
    const { data: claimed } = await admin
      .from("welcome_emails")
      .upsert({ user_id: user.user_id, email: user.email }, { onConflict: "user_id", ignoreDuplicates: true })
      .select("user_id");
    if (!claimed?.length) continue;

    const name = firstName(user.name);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: user.email,
        reply_to: "support@smallbird.in",
        subject: SUBJECT,
        html: emailHtml(name),
        text: emailText(name),
      }),
    });

    if (res.ok) {
      const { id } = await res.json().catch(() => ({ id: null }));
      await admin.from("welcome_emails").update({ resend_id: id }).eq("user_id", user.user_id);
      sent++;
    } else {
      // Release the claim so the next hourly run tries again.
      console.error("welcome-email: Resend send failed", user.user_id, res.status, await res.text());
      await admin.from("welcome_emails").delete().eq("user_id", user.user_id);
      failed++;
    }
    await new Promise((r) => setTimeout(r, SEND_GAP_MS));
  }

  return json({ sent, failed });
});
