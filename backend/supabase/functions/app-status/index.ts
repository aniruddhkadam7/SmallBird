// Public, unauthenticated status check: is SmallBird in maintenance mode?
// The desktop app calls it before opening the upgrade page, and the
// website's checkout should call it before creating a Razorpay order or
// subscription — nobody should be able to pay while the service is down.
//
// Response: { maintenance: boolean, message: string | null }

import { createClient } from "npm:@supabase/supabase-js@2";
import { withCors } from "../_shared/cors.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { data, error } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", ["maintenance_mode", "maintenance_message"]);
  if (error) {
    console.error("app-status: settings read failed", error);
    return new Response(JSON.stringify({ error: "Status unavailable" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const settings = Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const maintenance = settings["maintenance_mode"] === "true";
  return new Response(
    JSON.stringify({ maintenance, message: maintenance ? settings["maintenance_message"] ?? null : null }),
    { headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
}));
