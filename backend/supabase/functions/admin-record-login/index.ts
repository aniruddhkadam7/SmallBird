// Called by the admin console right after Supabase Auth sign-in succeeds, so
// every admin login shows up in admin_audit_logs. requireAdmin() re-verifies
// the allowlist server-side — a non-admin account that somehow signs in
// still can't produce an audit row or reach any other admin-* function.

import { adminErrorResponse, handlePreflight, jsonResponse, requireAdmin } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const ctx = await requireAdmin(req);

    await ctx.admin.from("admin_audit_logs").insert({
      admin_user_id: ctx.adminUserId,
      admin_email: ctx.adminEmail,
      action: "ADMIN_LOGIN",
      metadata: { ip: ctx.ip, user_agent: ctx.userAgent },
    });

    return jsonResponse({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
});
