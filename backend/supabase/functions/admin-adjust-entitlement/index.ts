// The ONLY way an admin can change a user's minute balance. Request body:
// { targetUserId: string, action: "GRANT" | "REMOVE" | "SET", amount: number,
//   reason: string }
//
// All the real work (locking the row, updating the balance, writing the
// ledger row, writing the audit row) happens atomically inside
// public.admin_adjust_entitlement() — see 0016_admin_console_foundation.sql.
// This function's job is just: verify the caller is an admin, validate the
// request shape, and never trust the caller's own claimed identity/IP for
// the audit trail (those come from requireAdmin()/the request, not the body).

import { adminErrorResponse, handlePreflight, jsonResponse, requireAdmin } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const ctx = await requireAdmin(req);
    const { targetUserId, action, amount, reason } = await req.json();

    if (typeof targetUserId !== "string") {
      return jsonResponse({ error: "Invalid targetUserId" }, 400);
    }
    if (action !== "GRANT" && action !== "REMOVE" && action !== "SET") {
      return jsonResponse({ error: "action must be GRANT, REMOVE, or SET" }, 400);
    }
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
      return jsonResponse({ error: "amount must be a non-negative number" }, 400);
    }
    if (typeof reason !== "string" || reason.trim().length === 0) {
      return jsonResponse({ error: "reason is required" }, 400);
    }

    let delta: number;
    if (action === "GRANT") {
      delta = amount;
    } else if (action === "REMOVE") {
      delta = -amount;
    } else {
      // SET: read the current balance first, then express it as a delta so
      // the ledger always records a real change, never a magic "set" op.
      const { data: current, error: currentErr } = await ctx.admin
        .from("entitlements")
        .select("remaining_minutes")
        .eq("user_id", targetUserId)
        .maybeSingle();
      if (currentErr) throw currentErr;
      if (!current) {
        return jsonResponse({ error: "No entitlement record for this user" }, 404);
      }
      delta = amount - Number(current.remaining_minutes);
    }

    if (delta === 0) {
      return jsonResponse({ error: "This change would not affect the balance" }, 400);
    }

    const source = delta >= 0 ? "ADMIN_GRANT" : "ADMIN_CORRECTION";

    const { data: newBalance, error } = await ctx.admin.rpc("admin_adjust_entitlement", {
      p_admin_user_id: ctx.adminUserId,
      p_admin_email: ctx.adminEmail,
      p_target_user_id: targetUserId,
      p_delta: delta,
      p_source: source,
      p_reason: reason.trim(),
      p_ip: ctx.ip,
      p_user_agent: ctx.userAgent,
    });
    if (error) throw error;

    return jsonResponse({ ok: true, newBalance });
  } catch (err) {
    return adminErrorResponse(err);
  }
});
