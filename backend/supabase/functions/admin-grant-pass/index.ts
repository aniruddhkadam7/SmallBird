// Grants a controlled, time-boxed pass (free trial, bonus minutes,
// promotional/extended access) to a user. Request body:
// { targetUserId, minutes, startAt?, expiresAt, reason, note? }
//
// Distinct from admin-adjust-entitlement: this one also sets
// entitlements.period_end, and the audit trail records it as GRANT_PASS
// with the expiration/note captured explicitly rather than folded into a
// free-text reason. All the real work happens atomically inside
// public.admin_grant_pass() -- see 0021_admin_phase3b.sql.

import { adminErrorResponse, handlePreflight, jsonResponse, requireAdmin } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const ctx = await requireAdmin(req);
    const { targetUserId, minutes, startAt, expiresAt, reason, note } = await req.json();

    if (typeof targetUserId !== "string") {
      return jsonResponse({ error: "Invalid targetUserId" }, 400);
    }
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) {
      return jsonResponse({ error: "minutes must be a non-negative number" }, 400);
    }
    if (typeof expiresAt !== "string" || Number.isNaN(Date.parse(expiresAt))) {
      return jsonResponse({ error: "expiresAt must be a valid date" }, 400);
    }
    if (typeof reason !== "string" || reason.trim().length === 0) {
      return jsonResponse({ error: "reason is required" }, 400);
    }
    const start = typeof startAt === "string" && !Number.isNaN(Date.parse(startAt)) ? startAt : new Date().toISOString();

    const { data: newBalance, error } = await ctx.admin.rpc("admin_grant_pass", {
      p_admin_user_id: ctx.adminUserId,
      p_admin_email: ctx.adminEmail,
      p_target_user_id: targetUserId,
      p_minutes: minutes,
      p_start_at: start,
      p_expires_at: expiresAt,
      p_reason: reason.trim(),
      p_note: typeof note === "string" && note.trim() ? note.trim() : null,
      p_ip: ctx.ip,
      p_user_agent: ctx.userAgent,
    });
    if (error) throw error;

    return jsonResponse({ ok: true, newBalance });
  } catch (err) {
    return adminErrorResponse(err);
  }
});
