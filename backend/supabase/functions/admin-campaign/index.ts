// Email campaigns from the admin console's Pricing & Offers page. Request
// body by `type`:
//   { type: "get" }                                  audience sizes + history
//   { type: "send_test", headline, body, ctaLabel?, ctaHref?, subject }
//                                                    one email, to the admin only
//   { type: "start", name, subject, headline, body, ctaLabel?, ctaHref?, audience }
//                                                    queues everyone, returns the campaign id
//   { type: "continue", campaignId }                 sends the next batch; call until remaining = 0
//
// Safeguards: only confirmed, un-banned, un-unsubscribed users are ever
// emailed (campaign_audience, migration 0068); each recipient is claimed
// before sending so nobody gets the same campaign twice; every email carries
// a signed unsubscribe link and List-Unsubscribe headers; every send is
// recorded in admin_audit_logs.

import { adminErrorResponse, AdminError, handlePreflight, jsonResponse, requireAdmin, type AdminContext } from "../_shared/admin.ts";
import { NOREPLY_ADDRESS, SUPPORT_EMAIL } from "../_shared/brand.ts";
import { campaignHtml, campaignText, unsubscribeOneClickUrl, unsubscribePageUrl, type CampaignContent } from "../_shared/campaign.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const AUDIENCES = ["all", "free", "buyers", "non_buyers"];
// Emails per request. Resend allows about 2 a second, so a batch takes ~15s
// and the admin console just keeps asking for the next one.
const BATCH = 25;
const SEND_GAP_MS = 600;

function bad(message: string): never {
  throw new AdminError(400, message);
}

function text(value: unknown, field: string, max: number, required = true): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) bad(`${field} is required`);
    return null;
  }
  if (typeof value !== "string") bad(`${field} must be text`);
  const trimmed = value.trim();
  if (!trimmed && required) bad(`${field} is required`);
  if (trimmed.length > max) bad(`${field} is too long (max ${max} characters)`);
  return trimmed || null;
}

function contentFrom(body: Record<string, unknown>): CampaignContent & { subject: string } {
  const ctaLabel = text(body.ctaLabel, "Button text", 40, false);
  const ctaHref = text(body.ctaHref, "Button link", 300, false);
  if (ctaHref && !ctaHref.startsWith("/") && !ctaHref.startsWith("https://")) bad("Button link must start with / or https://");
  if (Boolean(ctaLabel) !== Boolean(ctaHref)) bad("Set both the button text and the button link, or neither");
  return {
    subject: text(body.subject, "Subject", 150)!,
    headline: text(body.headline, "Headline", 120)!,
    body: text(body.body, "Message", 3000)!,
    ctaLabel,
    ctaHref,
  };
}

async function sendOne(to: string, name: string | null, userId: string, content: CampaignContent & { subject: string }, subjectPrefix = "") {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
  const pageUrl = await unsubscribePageUrl(userId);
  const oneClick = await unsubscribeOneClickUrl(userId);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: NOREPLY_ADDRESS,
      to,
      reply_to: SUPPORT_EMAIL,
      subject: `${subjectPrefix}${content.subject}`,
      html: campaignHtml(content, name, pageUrl),
      text: campaignText(content, name, pageUrl),
      headers: {
        "List-Unsubscribe": `<${oneClick}>, <mailto:${SUPPORT_EMAIL}?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function audit(ctx: AdminContext, action: string, newValue: unknown, reason: string | null) {
  const { error } = await ctx.admin.from("admin_audit_logs").insert({
    admin_user_id: ctx.adminUserId,
    admin_email: ctx.adminEmail,
    action,
    previous_value: null,
    new_value: newValue ?? null,
    reason,
    metadata: { ip: ctx.ip, user_agent: ctx.userAgent },
  });
  if (error) console.error("admin-campaign: audit log failed", error);
}

async function audience(ctx: AdminContext, which: string) {
  const { data, error } = await ctx.admin.rpc("campaign_audience", { p_audience: which });
  if (error) throw error;
  return (data ?? []) as { user_id: string; email: string; name: string | null }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const ctx = await requireAdmin(req);
    const body = await req.json().catch(() => ({}));

    switch (body.type) {
      case "get": {
        const counts: Record<string, number> = {};
        for (const a of AUDIENCES) counts[a] = (await audience(ctx, a)).length;
        const [campaigns, unsubscribed] = await Promise.all([
          ctx.admin.from("email_campaigns").select("*").order("created_at", { ascending: false }).limit(20),
          ctx.admin.from("email_unsubscribes").select("user_id", { count: "exact", head: true }),
        ]);
        if (campaigns.error) throw campaigns.error;
        return jsonResponse({
          counts,
          unsubscribed: unsubscribed.count ?? 0,
          campaigns: campaigns.data ?? [],
          emailConfigured: Boolean(RESEND_API_KEY),
        });
      }

      case "send_test": {
        const content = contentFrom(body);
        // To the signed-in admin only; their own account is the "recipient".
        await sendOne(ctx.adminEmail, null, ctx.adminUserId, content, "[TEST] ");
        await audit(ctx, "SEND_TEST_EMAIL", { to: ctx.adminEmail, subject: content.subject }, content.subject);
        return jsonResponse({ ok: true, to: ctx.adminEmail });
      }

      case "start": {
        const content = contentFrom(body);
        const name = text(body.name, "Campaign name", 80)!;
        if (!AUDIENCES.includes(body.audience)) bad("Choose who to send to");

        const running = await ctx.admin.from("email_campaigns").select("id").eq("status", "sending").limit(1);
        if (running.error) throw running.error;
        if (running.data?.length) bad("Another campaign is still sending. Wait for it to finish.");

        const people = await audience(ctx, body.audience);
        if (people.length === 0) bad("There is nobody to send to.");

        const { data: campaign, error } = await ctx.admin
          .from("email_campaigns")
          .insert({
            name,
            subject: content.subject,
            headline: content.headline,
            body: content.body,
            cta_label: content.ctaLabel,
            cta_href: content.ctaHref,
            audience: body.audience,
            recipient_count: people.length,
            created_by_email: ctx.adminEmail,
          })
          .select("id")
          .single();
        if (error) throw error;

        const { error: queueError } = await ctx.admin
          .from("email_campaign_sends")
          .insert(people.map((p) => ({ campaign_id: campaign.id, user_id: p.user_id, email: p.email })));
        if (queueError) throw queueError;

        await audit(ctx, "START_EMAIL_CAMPAIGN", { id: campaign.id, name, audience: body.audience, recipients: people.length, subject: content.subject }, name);
        return jsonResponse({ ok: true, campaignId: campaign.id, recipients: people.length });
      }

      case "continue": {
        const campaignId = text(body.campaignId, "campaignId", 64)!;
        const { data: campaign, error: findError } = await ctx.admin.from("email_campaigns").select("*").eq("id", campaignId).single();
        if (findError || !campaign) bad("Campaign not found");
        if (campaign.status === "sent") return jsonResponse({ ok: true, remaining: 0, sent: campaign.sent_count, failed: campaign.failed_count });

        const { data: queued, error: queueError } = await ctx.admin
          .from("email_campaign_sends")
          .select("user_id, email")
          .eq("campaign_id", campaignId)
          .eq("status", "queued")
          .limit(BATCH);
        if (queueError) throw queueError;

        // Claim before sending: a row only moves queued -> sending once, so a
        // second request (or a double click) can't send the same email again.
        const { data: claimed, error: claimError } = await ctx.admin
          .from("email_campaign_sends")
          .update({ status: "sending" })
          .eq("campaign_id", campaignId)
          .eq("status", "queued")
          .in("user_id", (queued ?? []).map((q) => q.user_id))
          .select("user_id, email");
        if (claimError) throw claimError;

        const content = {
          subject: campaign.subject,
          headline: campaign.headline,
          body: campaign.body,
          ctaLabel: campaign.cta_label,
          ctaHref: campaign.cta_href,
        };
        const unsubscribed = new Set(
          ((await ctx.admin.from("email_unsubscribes").select("user_id").in("user_id", (claimed ?? []).map((c) => c.user_id))).data ?? []).map(
            (r) => r.user_id as string,
          ),
        );

        let sent = 0;
        let failed = 0;
        for (const row of claimed ?? []) {
          // Someone who unsubscribed after the campaign was queued is skipped.
          if (unsubscribed.has(row.user_id)) {
            await ctx.admin.from("email_campaign_sends").update({ status: "failed", error: "unsubscribed" }).eq("campaign_id", campaignId).eq("user_id", row.user_id);
            failed++;
            continue;
          }
          try {
            const { data: u } = await ctx.admin.auth.admin.getUserById(row.user_id);
            const meta = u?.user?.user_metadata ?? {};
            const name = (meta.full_name ?? meta.name ?? null) as string | null;
            await sendOne(row.email, name, row.user_id, content);
            await ctx.admin.from("email_campaign_sends").update({ status: "sent" }).eq("campaign_id", campaignId).eq("user_id", row.user_id);
            sent++;
          } catch (err) {
            console.error("admin-campaign: send failed", row.email, err);
            await ctx.admin
              .from("email_campaign_sends")
              .update({ status: "failed", error: String(err instanceof Error ? err.message : err).slice(0, 300) })
              .eq("campaign_id", campaignId)
              .eq("user_id", row.user_id);
            failed++;
          }
          await sleep(SEND_GAP_MS);
        }

        const { count: remaining } = await ctx.admin
          .from("email_campaign_sends")
          .select("user_id", { count: "exact", head: true })
          .eq("campaign_id", campaignId)
          // A recipient stuck in "sending" (a request died mid-send) is left
          // unsent on purpose: re-sending could email them twice.
          .eq("status", "queued");
        const { count: totalSent } = await ctx.admin.from("email_campaign_sends").select("user_id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "sent");
        const { count: totalFailed } = await ctx.admin.from("email_campaign_sends").select("user_id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "failed");

        await ctx.admin
          .from("email_campaigns")
          .update({
            sent_count: totalSent ?? 0,
            failed_count: totalFailed ?? 0,
            ...(remaining === 0 ? { status: "sent", finished_at: new Date().toISOString() } : {}),
          })
          .eq("id", campaignId);
        if (remaining === 0) {
          await audit(ctx, "FINISH_EMAIL_CAMPAIGN", { id: campaignId, sent: totalSent, failed: totalFailed }, campaign.name);
        }
        return jsonResponse({ ok: true, remaining: remaining ?? 0, sent: totalSent ?? 0, failed: totalFailed ?? 0, batchSent: sent, batchFailed: failed });
      }

      default:
        return jsonResponse({ error: "Unknown request type" }, 400);
    }
  } catch (err) {
    return adminErrorResponse(err);
  }
});
