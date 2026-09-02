// Receives Stripe billing events and keeps public.subscriptions +
// public.entitlements in sync. This is the ONLY place those rows get
// written from outside a migration — never trust the client with its own
// plan or balance.
//
// IMPORTANT — when creating a Checkout Session on the website, you MUST set:
//   client_reference_id: <supabase user id>
//   metadata: { plan_id: <id from public.plans, e.g. "pro"> }
//   subscription_data: { metadata: { user_id: <supabase user id> } }  // subscription mode only
// This schema has no stripe_customer_id/stripe_subscription_id columns —
// user_id travels in Stripe metadata instead, so no extra columns needed.
//
// Configure in Stripe Dashboard -> Developers -> Webhooks:
//   URL: https://<project-ref>.supabase.co/functions/v1/stripe-webhook
//   Events: checkout.session.completed, invoice.paid, customer.subscription.deleted

import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function getPlanMinutes(planId: string): Promise<number> {
  const { data, error } = await admin.from("plans").select("included_minutes").eq("id", planId).single();
  if (error || !data) throw new Error(`Unknown plan_id: ${planId}`);
  return data.included_minutes;
}

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature!, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed", err);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      // Fires once, right after checkout — for BOTH subscription purchases
      // and one-time minute-pack purchases.
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        const planId = session.metadata?.plan_id;
        if (!userId || !planId) {
          console.error("checkout.session.completed missing client_reference_id or plan_id metadata");
          break;
        }

        const minutes = await getPlanMinutes(planId);

        if (session.mode === "subscription") {
          const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
          await admin.from("subscriptions").upsert({
            user_id: userId,
            plan: planId,
            status: "active",
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          });
          await admin.from("entitlements").update({ plan_id: planId }).eq("user_id", userId);
        }

        // Both subscription-first-period and one-time packs grant minutes here.
        await admin.rpc("increment_entitlement_minutes", { p_user_id: userId, p_minutes: minutes });
        break;
      }

      // Fires on each successful renewal invoice — top up minutes again for
      // the new billing period. billing_reason distinguishes renewal from
      // the very first invoice (already handled by checkout.session.completed).
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.billing_reason !== "subscription_cycle") break;

        const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
        const userId = subscription.metadata?.user_id;
        const planId = subscription.metadata?.plan_id;
        if (!userId || !planId) {
          console.error("invoice.paid: subscription missing user_id/plan_id metadata");
          break;
        }

        const minutes = await getPlanMinutes(planId);
        await admin
          .from("subscriptions")
          .update({ status: "active", current_period_end: new Date(subscription.current_period_end * 1000).toISOString() })
          .eq("user_id", userId);
        await admin.rpc("increment_entitlement_minutes", { p_user_id: userId, p_minutes: minutes });
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.user_id;
        if (!userId) break;

        await admin.from("subscriptions").update({ status: "canceled" }).eq("user_id", userId);
        await admin.from("entitlements").update({ plan_id: "free" }).eq("user_id", userId);
        break;
      }
    }
  } catch (err) {
    console.error("Error handling webhook event", event.type, err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { headers: { "content-type": "application/json" } });
});
