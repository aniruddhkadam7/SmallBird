// Mutating admin function: set an app_setting value or an api_key_store
// override. Request body:
//   { type: "setting", key: string, value: string }
//   { type: "api_key", keyName: string, value: string }
//   { type: "clear_api_key", keyName: string }
//
// All writes are audited via admin_audit_logs inside the SQL function.

import { adminErrorResponse, handlePreflight, jsonResponse, requireAdmin } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const ctx = await requireAdmin(req);
    const body = await req.json();

    if (body.type === "setting") {
      const { key, value } = body;
      if (typeof key !== "string" || key.trim().length === 0) {
        return jsonResponse({ error: "key is required" }, 400);
      }
      if (typeof value !== "string") {
        return jsonResponse({ error: "value must be a string" }, 400);
      }
      const { error } = await ctx.admin.rpc("admin_set_app_setting", {
        p_admin_user_id: ctx.adminUserId,
        p_admin_email: ctx.adminEmail,
        p_key: key.trim(),
        p_value: value.trim(),
        p_ip: ctx.ip,
        p_user_agent: ctx.userAgent,
      });
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (body.type === "api_key") {
      const { keyName, value } = body;
      if (typeof keyName !== "string" || keyName.trim().length === 0) {
        return jsonResponse({ error: "keyName is required" }, 400);
      }
      if (typeof value !== "string" || value.trim().length === 0) {
        return jsonResponse({ error: "value is required" }, 400);
      }
      const { error } = await ctx.admin.rpc("admin_set_api_key", {
        p_admin_user_id: ctx.adminUserId,
        p_admin_email: ctx.adminEmail,
        p_key_name: keyName.trim(),
        p_key_value: value.trim(),
        p_ip: ctx.ip,
        p_user_agent: ctx.userAgent,
      });
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (body.type === "clear_api_key") {
      const { keyName } = body;
      if (typeof keyName !== "string" || keyName.trim().length === 0) {
        return jsonResponse({ error: "keyName is required" }, 400);
      }
      const { error } = await ctx.admin.rpc("admin_clear_api_key", {
        p_admin_user_id: ctx.adminUserId,
        p_admin_email: ctx.adminEmail,
        p_key_name: keyName.trim(),
        p_ip: ctx.ip,
        p_user_agent: ctx.userAgent,
      });
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "type must be 'setting', 'api_key', or 'clear_api_key'" }, 400);
  } catch (err) {
    return adminErrorResponse(err);
  }
});
