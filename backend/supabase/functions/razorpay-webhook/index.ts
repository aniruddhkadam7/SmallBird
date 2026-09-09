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

async function getPlanMinutes(planId: string): Promise<number> {
  const { data, error } = await admin.from("plans").select("included_minutes").eq("id", planId).single();
  if (error || !data) throw new Error(`Unknown plan_id: ${planId}`);
  return data.included_minutes;
}

async function lookupUserEmail(userId: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) return null;
  return data.user.email;
}

const OWNER_NOTIFY_EMAIL = "payments@smallbird.in";
const FROM_ADDRESS = "SmallBird <noreply@smallbird.in>";

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
        if (await alreadyProcessed(eventType, order.id)) break;

        const minutes = await getPlanMinutes(planId);
        await admin.rpc("increment_entitlement_minutes", {
          p_user_id: userId,
          p_minutes: minutes,
          p_source: "PURCHASE",
          p_reference_id: order.id,
        });

        // Logged so "how many Interview Passes has this user bought" is a
        // real query, not something inferred from the minute balance.
        await admin.from("purchases").insert({
          user_id: userId,
          plan_id: planId,
          amount_paise: order.amount,
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

        const buyerEmail = await lookupUserEmail(userId);
        await notifyOwner(
          `💰 ${formatRupees(order.amount)} — ${planId}`,
          `<p>New purchase.</p><ul>
            <li>Plan: ${planId}</li>
            <li>Amount: ${formatRupees(order.amount)}</li>
            <li>Buyer: ${buyerEmail ?? userId}</li>
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
        if (await alreadyProcessed(eventType, payment.id)) break;

        const minutes = await getPlanMinutes(planId);
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
          p_minutes: minutes,
          p_source: "PURCHASE",
          p_reference_id: payment.id,
        });

        const chargedEmail = await lookupUserEmail(userId);
        await notifyOwner(
          `💰 ${formatRupees(payment.amount)} — ${planId} renewal`,
          `<p>Subscription charge succeeded.</p><ul>
            <li>Plan: ${planId}</li>
            <li>Amount: ${formatRupees(payment.amount)}</li>
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

        await admin.from("subscriptions").update({ status: "canceled" }).eq("user_id", userId);
        await admin.from("entitlements").update({ plan_id: "free" }).eq("user_id", userId);

        const cancelledEmail = await lookupUserEmail(userId);
        await notifyOwner(
          `📉 Subscription cancelled — ${cancelledEmail ?? userId}`,
          `<p>A subscription was cancelled and the account dropped to the free plan.</p>
           <p>Subscription: ${subscription.id}</p>`,
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

        await admin.from("subscriptions").update({ status: "halted" }).eq("user_id", userId);
        await admin.from("entitlements").update({ plan_id: "free" }).eq("user_id", userId);

        const haltedEmail = await lookupUserEmail(userId);
        await notifyOwner(
          `⚠️ Subscription halted — ${haltedEmail ?? userId}`,
          `<p>Razorpay halted a subscription after repeated failed renewal charges (expired card, insufficient funds, etc.) — the account was dropped to the free plan.</p>
           <p>Subscription: ${subscription.id}</p>`,
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
        const failedEmail = userId ? await lookupUserEmail(userId) : null;
        await notifyOwner(
          `❌ Payment failed — ${formatRupees(payment.amount)}`,
          `<p>A payment attempt failed.</p><ul>
            <li>Amount: ${formatRupees(payment.amount)}</li>
            <li>Reason: ${payment.error_description ?? payment.error_reason ?? "unknown"}</li>
            <li>Customer: ${failedEmail ?? userId ?? "unknown"}</li>
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
