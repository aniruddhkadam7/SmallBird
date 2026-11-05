// Pricing & Offers page of the admin console: plan prices, sales and the
// website announcement (banner / popup). Request body by `type`:
//   { type: "get" }
//   { type: "set_price", planId, inrPaise, usdCents }
//   { type: "start_sale", label, startsAt?, endsAt?,
//     plans: [{ planId, inrPaise: number|null, usdCents: number|null }] }
//   { type: "end_sale", planIds? }                 (all plans when omitted)
//   { type: "save_promotion", title, message?, ctaLabel?, ctaHref?,
//     showBanner, showPopup, startsAt?, endsAt? }
//   { type: "end_promotion", id }
//
// The website reads these tables directly (migration 0066), so changes show
// there within about a minute. Every write is recorded in admin_audit_logs.

import { adminErrorResponse, AdminError, handlePreflight, jsonResponse, requireAdmin, type AdminContext } from "../_shared/admin.ts";

const PLAN_COLUMNS =
  "id, display_name, included_minutes, is_active, price_inr_paise, price_usd_cents, sale_price_inr_paise, sale_price_usd_cents, sale_label, sale_starts_at, sale_ends_at, previous_price_inr_paise, previous_price_usd_cents, price_changed_at, updated_at";

function bad(message: string): never {
  throw new AdminError(400, message);
}

function positiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) bad(`${field} must be a whole number above 0`);
  return value;
}

function optionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) bad(`${field} must be a date`);
  return new Date(value).toISOString();
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") bad(`${field} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > max) bad(`${field} is too long (max ${max} characters)`);
  return trimmed || null;
}

async function audit(ctx: AdminContext, action: string, previous: unknown, next: unknown, reason: string | null) {
  const { error } = await ctx.admin.from("admin_audit_logs").insert({
    admin_user_id: ctx.adminUserId,
    admin_email: ctx.adminEmail,
    action,
    previous_value: previous ?? null,
    new_value: next ?? null,
    reason,
    metadata: { ip: ctx.ip, user_agent: ctx.userAgent },
  });
  if (error) console.error("admin-pricing: audit log failed", error);
}

async function loadPlans(ctx: AdminContext) {
  const { data, error } = await ctx.admin.from("plans").select(PLAN_COLUMNS).order("price_inr_paise");
  if (error) throw error;
  return data ?? [];
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const ctx = await requireAdmin(req);
    const body = await req.json().catch(() => ({}));

    switch (body.type) {
      case "get": {
        const [plans, promotions] = await Promise.all([
          loadPlans(ctx),
          ctx.admin.from("site_promotions").select("*").order("created_at", { ascending: false }).limit(30),
        ]);
        if (promotions.error) throw promotions.error;
        return jsonResponse({ plans, promotions: promotions.data ?? [], now: new Date().toISOString() });
      }

      case "set_price": {
        const planId = optionalText(body.planId, "planId", 40) ?? bad("planId is required");
        const inr = positiveInt(body.inrPaise, "India price");
        const usd = positiveInt(body.usdCents, "International price");
        const plans = await loadPlans(ctx);
        const plan = plans.find((p) => p.id === planId) ?? bad(`Unknown plan ${planId}`);
        if (plan.price_inr_paise === 0) bad("The free plan has no price");
        // A live sale must stay below the regular price.
        if ((plan.sale_price_inr_paise ?? 0) >= inr || (plan.sale_price_usd_cents ?? 0) >= usd) {
          const saleLive = !plan.sale_ends_at || Date.parse(plan.sale_ends_at) > Date.now();
          if (saleLive) bad("This plan has a sale at or above the new price. End the sale first.");
        }
        const { error } = await ctx.admin
          .from("plans")
          .update({ price_inr_paise: inr, price_usd_cents: usd, updated_at: new Date().toISOString() })
          .eq("id", planId);
        if (error) throw error;
        await audit(
          ctx,
          "SET_PLAN_PRICE",
          { plan: planId, inr_paise: plan.price_inr_paise, usd_cents: plan.price_usd_cents },
          { plan: planId, inr_paise: inr, usd_cents: usd },
          null,
        );
        return jsonResponse({ ok: true });
      }

      case "start_sale": {
        const label = optionalText(body.label, "Sale name", 60) ?? bad("Give the sale a name, e.g. Diwali Sale");
        const startsAt = optionalDate(body.startsAt, "Start");
        const endsAt = optionalDate(body.endsAt, "End");
        if (endsAt && Date.parse(endsAt) <= Date.now()) bad("The end time is in the past");
        if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) bad("The sale must end after it starts");
        if (!Array.isArray(body.plans) || body.plans.length === 0) bad("Pick at least one plan");

        const plans = await loadPlans(ctx);
        const updates = body.plans.map((entry: { planId?: string; inrPaise?: number | null; usdCents?: number | null }) => {
          const plan = plans.find((p) => p.id === entry.planId) ?? bad(`Unknown plan ${entry.planId}`);
          if (plan.price_inr_paise === 0) bad("The free plan can't go on sale");
          const inr = entry.inrPaise == null ? null : positiveInt(entry.inrPaise, `${plan.display_name} India sale price`);
          const usd = entry.usdCents == null ? null : positiveInt(entry.usdCents, `${plan.display_name} international sale price`);
          if (inr === null && usd === null) bad(`${plan.display_name}: set a sale price in at least one currency`);
          if (inr !== null && inr >= plan.price_inr_paise) bad(`${plan.display_name}: India sale price must be below the regular price`);
          if (usd !== null && usd >= plan.price_usd_cents) bad(`${plan.display_name}: international sale price must be below the regular price`);
          return { plan, inr, usd };
        });

        for (const { plan, inr, usd } of updates) {
          const { error } = await ctx.admin
            .from("plans")
            .update({
              sale_price_inr_paise: inr,
              sale_price_usd_cents: usd,
              sale_label: label,
              sale_starts_at: startsAt,
              sale_ends_at: endsAt,
              updated_at: new Date().toISOString(),
            })
            .eq("id", plan.id);
          if (error) throw error;
        }
        await audit(
          ctx,
          "START_SALE",
          updates.map(({ plan }) => ({
            plan: plan.id,
            sale_inr_paise: plan.sale_price_inr_paise,
            sale_usd_cents: plan.sale_price_usd_cents,
            ends_at: plan.sale_ends_at,
          })),
          { label, starts_at: startsAt, ends_at: endsAt, plans: updates.map(({ plan, inr, usd }) => ({ plan: plan.id, inr_paise: inr, usd_cents: usd })) },
          label,
        );
        return jsonResponse({ ok: true });
      }

      case "end_sale": {
        const ids: string[] | null = Array.isArray(body.planIds) && body.planIds.length ? body.planIds : null;
        const now = new Date().toISOString();
        const plans = (await loadPlans(ctx)).filter(
          (p) =>
            (ids === null || ids.includes(p.id)) &&
            (p.sale_price_inr_paise || p.sale_price_usd_cents) &&
            (!p.sale_ends_at || Date.parse(p.sale_ends_at) > Date.now()),
        );
        for (const plan of plans) {
          // A sale that hasn't started yet is simply removed; one that's on
          // ends now (the prices stay so payments already in checkout still
          // credit -- see plan_accepts_amount).
          const notStarted = plan.sale_starts_at && Date.parse(plan.sale_starts_at) > Date.now();
          const { error } = await ctx.admin
            .from("plans")
            .update(
              notStarted
                ? { sale_price_inr_paise: null, sale_price_usd_cents: null, sale_label: null, sale_starts_at: null, sale_ends_at: null, updated_at: now }
                : { sale_ends_at: now, updated_at: now },
            )
            .eq("id", plan.id);
          if (error) throw error;
        }
        await audit(ctx, "END_SALE", plans.map((p) => ({ plan: p.id, label: p.sale_label, ends_at: p.sale_ends_at })), { ended_at: now }, null);
        return jsonResponse({ ok: true, ended: plans.length });
      }

      case "save_promotion": {
        const title = optionalText(body.title, "Headline", 120) ?? bad("Write a headline");
        const message = optionalText(body.message, "Message", 300);
        const ctaLabel = optionalText(body.ctaLabel, "Button text", 40);
        const ctaHref = optionalText(body.ctaHref, "Button link", 300);
        if (ctaHref && !ctaHref.startsWith("/") && !ctaHref.startsWith("https://")) bad("Button link must start with / or https://");
        if (Boolean(ctaLabel) !== Boolean(ctaHref)) bad("Set both the button text and the button link, or neither");
        const showBanner = body.showBanner === true;
        const showPopup = body.showPopup === true;
        if (!showBanner && !showPopup) bad("Choose banner, popup, or both");
        const startsAt = optionalDate(body.startsAt, "Start") ?? new Date().toISOString();
        const endsAt = optionalDate(body.endsAt, "End");
        if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) bad("The announcement must end after it starts");

        const row = { title, message, cta_label: ctaLabel, cta_href: ctaHref, show_banner: showBanner, show_popup: showPopup, starts_at: startsAt, ends_at: endsAt };
        const { data, error } = await ctx.admin.from("site_promotions").insert(row).select("id").single();
        if (error) throw error;
        await audit(ctx, "CREATE_PROMOTION", null, { id: data.id, ...row }, title);
        return jsonResponse({ ok: true, id: data.id });
      }

      case "end_promotion": {
        const id = optionalText(body.id, "id", 64) ?? bad("id is required");
        const { data: promo, error: findError } = await ctx.admin.from("site_promotions").select("*").eq("id", id).single();
        if (findError || !promo) bad("Announcement not found");
        const notStarted = Date.parse(promo.starts_at) > Date.now();
        const { error } = notStarted
          ? await ctx.admin.from("site_promotions").delete().eq("id", id)
          : await ctx.admin.from("site_promotions").update({ ends_at: new Date().toISOString() }).eq("id", id);
        if (error) throw error;
        await audit(ctx, "END_PROMOTION", promo, { ended: true, deleted: notStarted }, promo.title);
        return jsonResponse({ ok: true });
      }

      default:
        return jsonResponse({ error: "Unknown request type" }, 400);
    }
  } catch (err) {
    return adminErrorResponse(err);
  }
});
