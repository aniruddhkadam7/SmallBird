// Ban or unban a user. Request body:
//   { targetUserId: string, action: "BAN" | "UNBAN", reason: string }
//
// BAN: sets is_banned=true on profiles, blocks all future session starts and
//      LLM proxy calls (enforced by requireEntitlement in _shared/entitlement.ts).
// UNBAN: clears the ban.
//
// Both actions are written to admin_audit_logs inside the SQL function.

import { adminErrorResponse, handlePreflight, jsonResponse, requireAdmin } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const ctx = await requireAdmin(req);
    const { targetUserId, action, reason } = await req.json();

    if (typeof targetUserId !== "string") {
      return jsonResponse({ error: "Invalid targetUserId" }, 400);
    }
    if (action !== "BAN" && action !== "UNBAN") {
      return jsonResponse({ error: "action must be BAN or UNBAN" }, 400);
    }
    if (typeof reason !== "string" || reason.trim().length === 0) {
      return jsonResponse({ error: "reason is required" }, 400);
    }

    const rpcName = action === "BAN" ? "admin_ban_user" : "admin_unban_user";
    const { error } = await ctx.admin.rpc(rpcName, {
      p_admin_user_id: ctx.adminUserId,
      p_admin_email: ctx.adminEmail,
      p_target_user_id: targetUserId,
      p_reason: reason.trim(),
      p_ip: ctx.ip,
      p_user_agent: ctx.userAgent,
    });
    if (error) throw error;

    return jsonResponse({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
});
