// Records the caller's device for a sign-in that didn't go through
// verify-otp -- the desktop app's Google sign-in exchanges its code with
// Supabase Auth directly, so nothing on our side saw it. The app calls this
// right after that sign-in succeeds (src-tauri/src/auth/oauth.rs).
//
// verify_jwt = true in config.toml, so the token is already verified.

import { createClient } from "npm:@supabase/supabase-js@2";
import { userIdFromVerifiedJwt } from "../_shared/entitlement.ts";
import { recordDevice } from "../_shared/device.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let userId: string;
  try {
    userId = userIdFromVerifiedJwt(jwt);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid session token" }), { status: 401, headers: { "content-type": "application/json" } });
  }

  await recordDevice(admin, req, userId, "sign_in");
  return new Response(null, { status: 204 });
});
