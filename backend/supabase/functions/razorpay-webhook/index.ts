// Receives Razorpay billing events and keeps public.subscriptions +
// public.entitlements in sync. This is the ONLY place those rows get
// written from outside a migration — never trust the client with its own
// plan or balance.
//
// IMPORTANT — when creating an Order/Subscription on the website, you MUST
// set `notes: { user_id: <supabase user id>, plan_id: <id from public.plans> }`
// (Razorpay's free-form metadata equivalent, max 15 keys) — that's how this
// function knows which user/plan a payment belongs to.
//
// Configure in Razorpay Dashboard -> Account & Settings -> Webhooks:
//   URL: https://<project-ref>.supabase.co/functions/v1/razorpay-webhook
//   Events: order.paid, subscription.charged, subscription.cancelled,
//           subscription.halted, refund.created, payment.failed

import { createClient } from "npm:@supabase/supabase-js@2";
import { MAIL_DOMAIN, NOREPLY_ADDRESS, SUPPORT_EMAIL } from "../_shared/brand.ts";

const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET")!;
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function verifySignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (expected.length !== signatureHeader.length) return false;
  // Constant-time compare — signature verification shouldn't leak timing info.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  }
  return diff === 0;
}

// Records that we've processed this exact event once — Razorpay retries
// undelivered-ack webhooks, and without this a retried order.paid/
// subscription.charged would double-credit minutes.
async function alreadyProcessed(eventType: string, entityId: string): Promise<boolean> {
  const { error } = await admin.from("webhook_events").insert({ event_type: eventType, entity_id: entityId });
  // Unique violation on (event_type, entity_id) means we've seen this exact
  // delivery's underlying entity before.
  return error?.code === "23505";
}

// Keeps the phone number, email and payment method the payer gave Razorpay
// at checkout, so the admin console can show how to reach a customer
// (migration 0062). Saved for failed payments too -- that's someone who
// tried to buy. Best-effort: a failure here must never fail the webhook,
// and the upsert on the payment id makes Razorpay's retries harmless.
async function savePaymentContact(userId: string, payment: any, status: string): Promise<void> {
  if (!payment?.id) return;
  const { error } = await admin.from("payment_contacts").upsert(
    {
      user_id: userId,
      razorpay_payment_id: payment.id,
      razorpay_order_id: payment.order_id ?? null,
      contact: payment.contact || null,
      email: payment.email || null,
      method: payment.method ?? null,
      vpa: payment.vpa ?? payment.upi?.vpa ?? null,
      bank: payment.bank ?? null,
      wallet: payment.wallet ?? null,
      amount_paise: amountInPaise(payment),
      currency: payment.currency ?? "INR",
      amount_minor: payment.amount ?? null,
      status,
    },
    { onConflict: "razorpay_payment_id" },
  );
  if (error) console.error("Failed to save payment contact", payment.id, error);
}

// Rupee value of a payment. International payments (migration 0065) are
// charged in USD; Razorpay's payment entity then carries base_amount, the
// amount converted to INR, which is what revenue totals add up.
function amountInPaise(payment: any): number | null {
  if (!payment) return null;
  if ((payment.currency ?? "INR") === "INR") return payment.amount ?? null;
  return payment.base_currency === "INR" ? (payment.base_amount ?? null) : null;
}

async function getPlan(planId: string): Promise<{ minutes: number; pricePaise: number; priceUsdCents: number | null }> {
  const { data, error } = await admin
    .from("plans")
    .select("included_minutes, price_inr_paise, price_usd_cents, is_active")
    .eq("id", planId)
    .single();
  if (error || !data) throw new Error(`Unknown plan_id: ${planId}`);
  if (!data.is_active) throw new Error(`Plan ${planId} is inactive — refusing to credit minutes for a retired plan`);
  return { minutes: data.included_minutes, pricePaise: data.price_inr_paise, priceUsdCents: data.price_usd_cents };
}

// notes.plan_id only says which plan the checkout *claimed*; the amount is
// what was actually paid. A stale Razorpay plan (e.g. an old ₹499 Pro) still
// carrying notes.plan_id "pro" must not be credited at the current plan's
// minutes — hold it for a manual decision instead.
async function amountMatchesPlan(
  planId: string,
  plan: { pricePaise: number; priceUsdCents: number | null },
  paid: number,
  currency: string,
  userId: string,
  ref: string,
): Promise<boolean> {
  const price = currency === "USD" ? plan.priceUsdCents : currency === "INR" ? plan.pricePaise : null;
  if (price !== null && paid === price) return true;
  console.error("razorpay-webhook: amount/plan mismatch", { planId, price, paid, currency, userId, ref });
  const email = await lookupUserEmail(userId);
  await notifyOwner(
    `⚠️ Payment amount mismatch — ${formatMoney(paid, currency)} for ${planId}`,
    `<p>A payment did not match the plan's current price, so <strong>no minutes were credited</strong>. Credit this user manually.</p><ul>
      <li>Plan: ${planId} (price ${price === null ? `none in ${escapeHtml(currency)}` : formatMoney(price, currency)})</li>
      <li>Paid: ${formatMoney(paid, currency)}</li>
      <li>Customer: ${email ?? userId}</li>
      <li>Reference: ${ref}</li>
    </ul>`,
  );
  return false;
}

async function lookupUserEmail(userId: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) return null;
  return data.user.email;
}

const OWNER_NOTIFY_EMAIL = `payments@${MAIL_DOMAIN}`;
const FROM_ADDRESS = NOREPLY_ADDRESS;

// Best-effort operational email to the business owner — money in, money
// stuck, or a subscription drying up. Never throws: a Resend hiccup must
// never fail the webhook response, which would make Razorpay retry the
// whole event and re-run the DB writes above against already-idempotent
// guards for nothing. Deliberately awaited (not truly fire-and-forget) —
// an unawaited fetch can get cut off once this function's response goes
// out, since Edge Functions don't keep running in the background on their
// own; Resend is fast enough that awaiting it adds negligible latency.
async function notifyOwner(subject: string, html: string): Promise<void> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.error("razorpay-webhook: RESEND_API_KEY not set, skipping owner notification");
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: FROM_ADDRESS, to: OWNER_NOTIFY_EMAIL, subject, html }),
    });
    if (!res.ok) console.error("razorpay-webhook: owner notification failed", res.status, await res.text());
  } catch (err) {
    console.error("razorpay-webhook: owner notification threw", err);
  }
}

function formatRupees(amountPaise: number): string {
  return `₹${(amountPaise / 100).toFixed(2)}`;
}

// amount is in the currency's smallest unit (paise, cents).
function formatMoney(amount: number, currency: string | null | undefined): string {
  if (!currency || currency === "INR") return formatRupees(amount);
  if (currency === "USD") return `$${(amount / 100).toFixed(2)}`;
  return `${(amount / 100).toFixed(2)} ${currency}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
}

function formatMinutes(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} hours (${minutes} minutes)`;
  return `${minutes} minutes`;
}

// Best-effort receipt/thank-you email to the paying customer. Same
// never-throws contract as notifyOwner: the payment is already recorded,
// so an email failure must not make Razorpay retry the webhook.
async function notifyCustomer(
  userId: string,
  kind: "purchase" | "renewal",
  details: { planId: string; amount: number; currency: string; minutes: number; reference: string; renewsOn?: string | null },
): Promise<void> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return;
  const to = await lookupUserEmail(userId);
  if (!to) return;

  const planName = details.planId.charAt(0).toUpperCase() + details.planId.slice(1).replace(/[_-]/g, " ");
  const isRenewal = kind === "renewal";
  const subject = isRenewal ? `Your SmallBird AI ${planName} plan has been renewed` : `Welcome to SmallBird AI ${planName} — payment received`;
  const heading = isRenewal ? "Thanks for staying with us! 🎉" : "Thank you for your purchase! 🎉";
  const intro = isRenewal
    ? `Your <strong>${escapeHtml(planName)}</strong> subscription has renewed successfully and fresh minutes have been added to your account.`
    : `Your payment was successful and your <strong>${escapeHtml(planName)}</strong> plan is now active. Open the SmallBird AI app and you're ready to go — your minutes are already in your account.`;
  const row = (label: string, value: string) =>
    `<tr><td style="padding:8px 0;color:#6b7280">${label}</td><td style="padding:8px 0;text-align:right;font-weight:600;color:#111827">${value}</td></tr>`;

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827">
    <h2 style="margin:0 0 12px">${heading}</h2>
    <p style="line-height:1.6;margin:0 0 20px">${intro}</p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb">
      ${row("Plan", escapeHtml(planName))}
      ${row("Amount paid", formatMoney(details.amount, details.currency))}
      ${row("Minutes added", formatMinutes(details.minutes))}
      ${details.renewsOn ? row(isRenewal ? "Next renewal" : "Renews on", formatDate(details.renewsOn)) : ""}
      ${row("Reference", escapeHtml(details.reference))}
    </table>
    <p style="line-height:1.6;margin:20px 0 0;color:#374151">🔒 Your payment was processed securely by Razorpay. SmallBird AI never sees or stores your card details.${isRenewal ? " You can cancel your subscription at any time and keep access until the end of the period you've paid for." : ""}</p>
    <div style="margin:20px 0 0;padding:16px;background:#f3f4f6;border-radius:8px">
      <p style="margin:0 0 6px;font-weight:600">Need help? We're here for you.</p>
      <p style="margin:0;line-height:1.6;color:#374151">Questions about your plan, billing, a refund, or anything not working? Simply reply to this email or contact us at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> — a real person will get back to you.</p>
    </div>
    <p style="margin:20px 0 0;color:#374151">Thank you for trusting SmallBird AI.<br>— The SmallBird AI team</p>
    <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#9ca3af">This is a payment confirmation for your records. We will never ask for your password, OTP or card details by email. If you didn't make this purchase, contact ${SUPPORT_EMAIL} right away.</p>
  </div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html, reply_to: SUPPORT_EMAIL }),
    });
    if (!res.ok) console.error("razorpay-webhook: customer email failed", res.status, await res.text());
  } catch (err) {
    console.error("razorpay-webhook: customer email threw", err);
  }
}

Deno.serve(async (req) => {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature");

  if (!(await verifySignature(rawBody, signature))) {
    console.error("Razorpay webhook signature verification failed");
    return new Response("Invalid signature", { status: 400 });
  }

  const body = JSON.parse(rawBody);
  const eventType = body.event as string;

  try {
    switch (eventType) {
      case "order.paid": {
        const order = body.payload.order.entity;
        const userId = order.notes?.user_id;
        const planId = order.notes?.plan_id;
        if (!userId || !planId) {
          console.error("order.paid missing notes.user_id/plan_id", order.id);
          break;
        }
        await savePaymentContact(userId, body.payload.payment?.entity, "paid");
        const plan = await getPlan(planId);
        if (!(await amountMatchesPlan(planId, plan, order.amount_paid, order.currency, userId, order.id))) break;
        if (await alreadyProcessed(eventType, order.id)) break;

        await admin.rpc("increment_entitlement_minutes", {
          p_user_id: userId,
          p_minutes: plan.minutes,
          p_source: "PURCHASE",
          p_reference_id: order.id,
        });

        // Logged so "how many Interview Passes has this user bought" is a
        // real query, not something inferred from the minute balance.
        await admin.from("purchases").insert({
          user_id: userId,
          plan_id: planId,
          amount_paise: order.currency === "INR" ? order.amount : amountInPaise(body.payload.payment?.entity),
          currency: order.currency,
          amount_minor: order.amount,
          razorpay_order_id: order.id,
        });

        // A paying customer's row shouldn't just read "free" — reflect the
        // one-time pack they bought. Only overwrites plan_id while it's
        // still "free", so this never downgrades someone with an active
        // Pro subscription who also buys a pass on top.
        const { data: current } = await admin.from("entitlements").select("plan_id").eq("user_id", userId).single();
        if (current?.plan_id === "free") {
          await admin.from("entitlements").update({ plan_id: planId }).eq("user_id", userId);
        }

        await notifyCustomer(userId, "purchase", {
          planId,
          amount: order.amount,
          currency: order.currency,
          minutes: plan.minutes,
          reference: order.id,
        });

        const buyerEmail = await lookupUserEmail(userId);
        await notifyOwner(
          `💰 ${formatMoney(order.amount, order.currency)} — ${planId}`,
          `<p>New purchase.</p><ul>
            <li>Plan: ${planId}</li>
            <li>Amount: ${formatMoney(order.amount, order.currency)}</li>
            <li>Buyer: ${buyerEmail ?? userId}</li>
            <li>Phone: ${escapeHtml(body.payload.payment?.entity?.contact || "--")}</li>
            <li>Order: ${order.id}</li>
          </ul>`,
        );
        break;
      }

      // Fires on every successful recurring charge, including the first —
      // use the payment id (not the subscription id) as the idempotency
      // key, since the same subscription charges repeatedly over its life.
      case "subscription.charged": {
        const subscription = body.payload.subscription.entity;
        const payment = body.payload.payment.entity;
        const userId = subscription.notes?.user_id;
        const planId = subscription.notes?.plan_id;
        if (!userId || !planId) {
          console.error("subscription.charged missing notes.user_id/plan_id", subscription.id);
          break;
        }
        await savePaymentContact(userId, payment, "paid");
        const plan = await getPlan(planId);
        if (!(await amountMatchesPlan(planId, plan, payment.amount, payment.currency, userId, payment.id))) break;
        if (await alreadyProcessed(eventType, payment.id)) break;

        // onConflict: "user_id" targets the unique constraint added in
        // 0014_lock_down_entitlement_rpcs.sql — without it, every renewal
        // charge inserted a brand-new subscriptions row instead of updating
        // the existing one, leaving duplicate/stale rows per user.
        await admin.from("subscriptions").upsert(
          {
            user_id: userId,
            plan: planId,
            status: "active",
            current_period_end: new Date(subscription.current_end * 1000).toISOString(),
          },
          { onConflict: "user_id" },
        );
        await admin.from("entitlements").update({ plan_id: planId }).eq("user_id", userId);
        await admin.rpc("increment_entitlement_minutes", {
          p_user_id: userId,
          p_minutes: plan.minutes,
          p_source: "PURCHASE",
          p_reference_id: payment.id,
        });

        // paid_count is 1 on the first charge and increments on each renewal.
        await notifyCustomer(userId, Number(subscription.paid_count) > 1 ? "renewal" : "purchase", {
          planId,
          amount: payment.amount,
          currency: payment.currency,
          minutes: plan.minutes,
          reference: payment.id,
          renewsOn: subscription.current_end ? new Date(subscription.current_end * 1000).toISOString() : null,
        });

        const chargedEmail = await lookupUserEmail(userId);
        await notifyOwner(
          `💰 ${formatMoney(payment.amount, payment.currency)} — ${planId} renewal`,
          `<p>Subscription charge succeeded.</p><ul>
            <li>Plan: ${planId}</li>
            <li>Amount: ${formatMoney(payment.amount, payment.currency)}</li>
            <li>Customer: ${chargedEmail ?? userId}</li>
            <li>Subscription: ${subscription.id}</li>
          </ul>`,
        );
        break;
      }

      case "subscription.cancelled": {
        const subscription = body.payload.subscription.entity;
        const userId = subscription.notes?.user_id;
        if (!userId) break;
        if (await alreadyProcessed(eventType, subscription.id)) break;

        // Mark as cancelled but keep the paid plan active until the current
        // period ends — standard "cancel at period end" behaviour. The
        // entitlement check in _shared/entitlement.ts already rejects access
        // once period_end has passed, so we don't need to touch plan_id here.
        const periodEnd = subscription.current_end
          ? new Date(subscription.current_end * 1000).toISOString()
          : null;
        await admin.from("subscriptions").update({ status: "canceled" }).eq("user_id", userId);
        if (periodEnd) {
          await admin.from("entitlements").update({ period_end: periodEnd }).eq("user_id", userId);
        }

        const cancelledEmail = await lookupUserEmail(userId);
        await notifyOwner(
          `📉 Subscription cancelled — ${cancelledEmail ?? userId}`,
          `<p>Subscription was cancelled. Access continues until period end.</p>
           <ul>
             <li>Subscription: ${subscription.id}</li>
             <li>Access until: ${periodEnd ?? "unknown"}</li>
           </ul>`,
        );
        break;
      }

      // Razorpay auto-halts a subscription after repeated failed renewal
      // charges (expired card, insufficient funds, etc.) instead of
      // cancelling it outright — without this case, that user keeps full
      // paid access indefinitely even though billing has actually stopped.
      case "subscription.halted": {
        const subscription = body.payload.subscription.entity;
        const userId = subscription.notes?.user_id;
        if (!userId) break;
        if (await alreadyProcessed(eventType, subscription.id)) break;

        // Halted means Razorpay gave up collecting — expire access at period
        // end instead of immediately, same as cancellation, to avoid cutting
        // off a user who may just need to update their payment method.
        const haltedPeriodEnd = subscription.current_end
          ? new Date(subscription.current_end * 1000).toISOString()
          : null;
        await admin.from("subscriptions").update({ status: "halted" }).eq("user_id", userId);
        if (haltedPeriodEnd) {
          await admin.from("entitlements").update({ period_end: haltedPeriodEnd }).eq("user_id", userId);
        } else {
          // No period end from Razorpay — drop to free immediately as a safe fallback.
          await admin.from("entitlements").update({ plan_id: "free" }).eq("user_id", userId);
        }

        const haltedEmail = await lookupUserEmail(userId);
        await notifyOwner(
          `⚠️ Subscription halted — ${haltedEmail ?? userId}`,
          `<p>Razorpay halted a subscription after repeated failed renewal charges (expired card, insufficient funds, etc.).</p>
           <ul>
             <li>Subscription: ${subscription.id}</li>
             <li>Access until: ${haltedPeriodEnd ?? "dropped to free immediately"}</li>
           </ul>`,
        );
        break;
      }

      // A refund (one-time Interview Pass or a subscription charge) hands
      // the money back — without this, the buyer keeps the plan/minutes
      // that money paid for. Deliberately doesn't try to claw back a
      // precise number of already-used minutes; just drops the account to
      // free, the same simplification subscription.cancelled makes. A
      // refund is rare/manual enough that this is worth the simplicity.
      case "refund.created": {
        const payment = body.payload.payment?.entity;
        const refund = body.payload.refund.entity;
        const userId = payment?.notes?.user_id;
        if (!userId) {
          console.error("refund.created missing payment.notes.user_id", refund.id);
          break;
        }
        if (await alreadyProcessed(eventType, refund.id)) break;

        await admin.from("entitlements").update({ plan_id: "free" }).eq("user_id", userId);
        // No-op for a refunded one-time purchase (that user never had a
        // subscriptions row to begin with) — only meaningful when the
        // refund is for a subscription charge.
        await admin.from("subscriptions").update({ status: "canceled" }).eq("user_id", userId);
        break;
      }

      // Nothing was ever granted for a failed payment, so there's no DB
      // state to fix here — purely a heads-up so a declined card or
      // insufficient-funds failure doesn't go unnoticed.
      case "payment.failed": {
        const payment = body.payload.payment.entity;
        if (await alreadyProcessed(eventType, payment.id)) break;

        const userId = payment.notes?.user_id;
        if (userId) await savePaymentContact(userId, payment, "failed");
        const failedEmail = userId ? await lookupUserEmail(userId) : null;
        await notifyOwner(
          `❌ Payment failed — ${formatMoney(payment.amount, payment.currency)}`,
          `<p>A payment attempt failed.</p><ul>
            <li>Amount: ${formatMoney(payment.amount, payment.currency)}</li>
            <li>Reason: ${payment.error_description ?? payment.error_reason ?? "unknown"}</li>
            <li>Customer: ${failedEmail ?? userId ?? "unknown"}</li>
            <li>Phone: ${escapeHtml(payment.contact || "--")}</li>
            <li>Payment: ${payment.id}</li>
          </ul>`,
        );
        break;
      }
    }
  } catch (err) {
    console.error("Error handling webhook event", eventType, err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { headers: { "content-type": "application/json" } });
});
