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
//   Events: order.paid, subscription.charged, subscription.cancelled

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
        await admin.rpc("increment_entitlement_minutes", { p_user_id: userId, p_minutes: minutes });

        // A paying customer's row shouldn't just read "free" — reflect the
        // one-time pack they bought. Only overwrites plan_id while it's
        // still "free", so this never downgrades someone with an active
        // Pro subscription who also buys a pass on top.
        const { data: current } = await admin.from("entitlements").select("plan_id").eq("user_id", userId).single();
        if (current?.plan_id === "free") {
          await admin.from("entitlements").update({ plan_id: planId }).eq("user_id", userId);
        }
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
        await admin.from("subscriptions").upsert({
          user_id: userId,
          plan: planId,
          status: "active",
          current_period_end: new Date(subscription.current_end * 1000).toISOString(),
        });
        await admin.from("entitlements").update({ plan_id: planId }).eq("user_id", userId);
        await admin.rpc("increment_entitlement_minutes", { p_user_id: userId, p_minutes: minutes });
        break;
      }

      case "subscription.cancelled": {
        const subscription = body.payload.subscription.entity;
        const userId = subscription.notes?.user_id;
        if (!userId) break;

        await admin.from("subscriptions").update({ status: "canceled" }).eq("user_id", userId);
        await admin.from("entitlements").update({ plan_id: "free" }).eq("user_id", userId);
        break;
      }
    }
  } catch (err) {
    console.error("Error handling webhook event", eventType, err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { headers: { "content-type": "application/json" } });
});
