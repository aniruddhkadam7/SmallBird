// Website traffic for the admin console's Analytics page (migration 0063).
// The website's /api/track route (SmallBird-website src/app/api/track) calls
// this server-to-server for every page view, page exit and key click, adding
// Vercel's geo headers, the visitor's IP and user agent, and the signed-in
// user's access token if there is one.
//
// verify_jwt = false in config.toml: most visitors aren't signed in. Nothing
// here is trusted beyond "a browser said so" -- it's capped, rate limited per
// IP and bot-filtered, and a user id is only kept from a token Supabase Auth
// verifies.
//
// Body, one of:
//   { type: "view", id, visitorId, sessionId, path, referrer?, utm?: {source, medium, campaign, term, content} }
//   { type: "leave", id, visitorId, durationMs }
//   { type: "event", id, visitorId, sessionId, path, name }

import { createClient } from "npm:@supabase/supabase-js@2";
import { allowRequest } from "../_shared/ratelimit.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|facebookexternalhit|whatsapp|telegram|curl|wget|python|axios|node-fetch|go-http|vercel|monitor|pingdom|uptime/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DURATION_MS = 2 * 60 * 60 * 1000;

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

function device(ua: string): string {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android/i.test(ua)) return "mobile";
  return "desktop";
}

function browser(ua: string): string {
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/samsungbrowser/i.test(ua)) return "Samsung Internet";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/chrome|crios/i.test(ua)) return "Chrome";
  if (/safari/i.test(ua)) return "Safari";
  return "Other";
}

function os(ua: string): string {
  if (/windows/i.test(ua)) return "Windows";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/android/i.test(ua)) return "Android";
  if (/mac os x|macintosh/i.test(ua)) return "macOS";
  if (/cros/i.test(ua)) return "ChromeOS";
  if (/linux/i.test(ua)) return "Linux";
  return "Other";
}

function referrerHost(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.replace(/^www\./, "").slice(0, 200);
  } catch {
    return null;
  }
}

/** Vercel sends city names URL-encoded ("New%20Delhi"). */
function header(req: Request, name: string): string | null {
  const v = req.headers.get(name);
  if (!v) return null;
  try {
    return decodeURIComponent(v).slice(0, 100);
  } catch {
    return v.slice(0, 100);
  }
}

async function userIdFrom(token: string | null): Promise<string | null> {
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : (data.user?.id ?? null);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const ua = req.headers.get("x-visitor-ua") ?? "";
  if (!ua || BOT.test(ua)) return new Response(null, { status: 204 });
  const ip = req.headers.get("x-visitor-ip") ?? "unknown";
  if (!(await allowRequest(admin, `track:${ip}`, 120, 60))) return new Response(null, { status: 429 });

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 8_000) return new Response(null, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }

  const id = str(body.id, 36);
  const visitorId = str(body.visitorId, 36);
  if (!id || !UUID.test(id) || !visitorId || !UUID.test(visitorId)) return new Response(null, { status: 400 });

  if (body.type === "leave") {
    const ms = Math.round(Number(body.durationMs));
    if (!Number.isFinite(ms) || ms <= 0) return new Response(null, { status: 204 });
    await admin
      .from("web_events")
      .update({ duration_ms: Math.min(ms, MAX_DURATION_MS) })
      .eq("id", id)
      .eq("visitor_id", visitorId)
      .is("duration_ms", null);
    return new Response(null, { status: 204 });
  }

  if (body.type !== "view" && body.type !== "event") return new Response(null, { status: 400 });
  const sessionId = str(body.sessionId, 36);
  const path = str(body.path, 300);
  if (!sessionId || !UUID.test(sessionId) || !path?.startsWith("/")) return new Response(null, { status: 400 });

  const userId = await userIdFrom(str(req.headers.get("x-user-token"), 4000));
  const utm = (body.utm && typeof body.utm === "object" ? body.utm : {}) as Record<string, unknown>;
  const referrer = str(body.referrer, 500);

  const { error } = await admin.from("web_events").insert({
    id,
    kind: body.type,
    name: body.type === "event" ? str(body.name, 60) : null,
    visitor_id: visitorId,
    session_id: sessionId,
    user_id: userId,
    path,
    referrer,
    referrer_host: referrerHost(referrer),
    utm_source: str(utm.source, 100),
    utm_medium: str(utm.medium, 100),
    utm_campaign: str(utm.campaign, 150),
    utm_term: str(utm.term, 150),
    utm_content: str(utm.content, 150),
    country: header(req, "x-visitor-country"),
    region: header(req, "x-visitor-region"),
    city: header(req, "x-visitor-city"),
    device: device(ua),
    browser: browser(ua),
    os: os(ua),
  });
  if (error && error.code !== "23505") console.error("web_events insert failed", error);

  // Once a visitor signs in, their earlier anonymous visits are theirs too,
  // so a sign-up can be credited to the channel that first brought them.
  if (userId) {
    await admin.from("web_events").update({ user_id: userId }).eq("visitor_id", visitorId).is("user_id", null);
  }
  return new Response(null, { status: 204 });
});
