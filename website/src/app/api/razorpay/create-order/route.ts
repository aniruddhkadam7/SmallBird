import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPlan, planAmount, PAID_PLAN_IDS, type PlanId } from "@/lib/plans"
import { currencyForCountry } from "@/lib/currency"

// Creates a Razorpay Order for a one-time pass (Starter / Pro / Pro+).
// RAZORPAY_KEY_SECRET never reaches the client — only the resulting
// order_id + the public key id do, which is what Checkout.js needs.
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Please log in first" }, { status: 401 })
  }

  const { planId } = (await request.json()) as { planId?: PlanId }
  if (!planId || !PAID_PLAN_IDS.has(planId)) {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 })
  }

  const plan = getPlan(planId)
  // Decided here from the request's country, never by the client, so
  // nobody outside India can pick the rupee price.
  const currency = currencyForCountry(request.headers.get("x-vercel-ip-country"))
  const keyId = process.env.RAZORPAY_KEY_ID!
  const keySecret = process.env.RAZORPAY_KEY_SECRET!
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64")

  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: JSON.stringify({
      amount: planAmount(plan, currency),
      currency,
      // Razorpay's free-form metadata (max 15 keys) — the razorpay-webhook
      // Edge Function reads user_id/plan_id from here to credit the right
      // account, since this schema has no stripe_customer_id-style column.
      notes: { user_id: user.id, plan_id: planId },
    }),
  })

  const order = await response.json()
  if (!response.ok) {
    return NextResponse.json({ error: order.error?.description ?? "Could not create order" }, { status: 502 })
  }

  return NextResponse.json({
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
  })
}
