// Opt-out from marketing email. Called from the website's /unsubscribe page
// (JSON POST) and by mail apps' own "unsubscribe" button (List-Unsubscribe
// one-click POST). The link is signed, so it only ever unsubscribes the
// person it was made for. No login: the signed link is the proof.

import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyUnsubscribeToken } from "../_shared/campaign.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // The user id and token arrive in the query string (one-click from a mail
  // app) or in a JSON body (the website's page).
  const url = new URL(req.url);
  let userId = url.searchParams.get("u");
  let token = url.searchParams.get("t");
  if (!userId || !token) {
    const body = await req.json().catch(() => ({}));
    userId = typeof body.u === "string" ? body.u : null;
    token = typeof body.t === "string" ? body.t : null;
  }
  if (!userId || !token || !/^[0-9a-f-]{36}$/.test(userId) || !(await verifyUnsubscribeToken(userId, token))) {
    return json({ error: "This unsubscribe link isn't valid." }, 400);
  }

  const { data: user, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError || !user?.user?.email) return json({ error: "This unsubscribe link isn't valid." }, 400);

  const { error } = await admin
    .from("email_unsubscribes")
    .upsert({ user_id: userId, email: user.user.email }, { onConflict: "user_id", ignoreDuplicates: true });
  if (error) {
    console.error("unsubscribe failed", error);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
  return json({ ok: true });
});
