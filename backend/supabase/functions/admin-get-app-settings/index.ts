// Returns all app_settings rows and api_key_store rows (masked) for the
// admin console Settings page. Both RPCs embed their own admin check via
// current_admin_user_id(), so this is just two parallel DB calls.
//
// Each api key row also gets the env secret the edge functions actually use
// today (envSet + a masked envHint) -- never the full value -- so the console
// can show which key is live. The admin check has already passed by then:
// both RPCs above throw for non-admins.

import { adminErrorResponse, getUserClient, handlePreflight, jsonResponse, throwOnRpcError } from "../_shared/admin.ts";

// api_key_store key name -> the env secret the edge functions read.
const ENV_SECRET_FOR_KEY: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  deepgram: "DEEPGRAM_API_KEY",
  razorpay_key_id: "RAZORPAY_KEY_ID",
  razorpay_key_secret: "RAZORPAY_KEY_SECRET",
};

/// First and last 4 characters only, e.g. "sk-p…a1b2". Short values show
/// just the last 2 so a short secret is never mostly revealed.
function maskSecret(value: string): string {
  if (value.length <= 12) return `…${value.slice(-2)}`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const client = getUserClient(req);

    const [settingsResult, keysResult] = await Promise.all([
      client.rpc("admin_get_app_settings"),
      client.rpc("admin_get_api_keys"),
    ]);

    if (settingsResult.error) throwOnRpcError(settingsResult.error);
    if (keysResult.error) throwOnRpcError(keysResult.error);

    // deno-lint-ignore no-explicit-any
    const apiKeys = ((keysResult.data ?? []) as any[]).map((row) => {
      const envName = ENV_SECRET_FOR_KEY[row.keyName];
      const envValue = envName ? (Deno.env.get(envName) ?? "").trim() : "";
      return { ...row, envName: envName ?? null, envSet: envValue.length > 0, envHint: envValue ? maskSecret(envValue) : null };
    });

    return jsonResponse({
      settings: settingsResult.data ?? {},
      apiKeys,
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
});
