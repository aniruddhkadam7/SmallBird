import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import type { PlanId } from "@/lib/plans"

// Creates a Razorpay Subscription for a recurring plan (Pro/Pro Plus)
// against a pre-created Razorpay-side Plan (see backend/README.md's
// Razorpay setup checklist) — distinct from our own public.plans.id.
// plan_TlUIuWNuGmjcEy = Pro ₹749/month
// plan_TlUIv4wCo8Z8gG = Pro+ ₹1399/month
// Env vars take precedence so these can be overridden without a code change.
const RAZORPAY_PLAN_ID_BY_PLAN: Partial<Record<PlanId, string | undefined>> = {
  pro: process.env.RAZORPAY_PLAN_ID_PRO ?? "plan_TlUIuWNuGmjcEy",
  "pro-plus": process.env.RAZORPAY_PLAN_ID_PRO_PLUS ?? "plan_TlUIv4wCo8Z8gG",
}

// Razorpay subscriptions require a total_count of billing cycles up front —
// there's no "until cancelled" option. 120 monthly cycles is effectively-
// unlimited runway (10 years); the user can cancel anytime via the
// webhook's subscription.cancelled handling.
const TOTAL_COUNT_BY_PLAN: Partial<Record<PlanId, number>> = {
  pro: 120,
  "pro-plus": 120,
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Please log in first" }, { status: 401 })
  }

  const { planId } = (await request.json()) as { planId?: PlanId }
  const razorpayPlanId = planId ? RAZORPAY_PLAN_ID_BY_PLAN[planId] : undefined
  const totalCount = planId ? TOTAL_COUNT_BY_PLAN[planId] : undefined
  if (!razorpayPlanId || !totalCount) {
    return NextResponse.json({ error: "This plan isn't a subscription" }, { status: 400 })
  }

  const keyId = process.env.RAZORPAY_KEY_ID!
  const keySecret = process.env.RAZORPAY_KEY_SECRET!
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64")

  const response = await fetch("https://api.razorpay.com/v1/subscriptions", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: JSON.stringify({
      plan_id: razorpayPlanId,
      customer_notify: 1,
      total_count: totalCount,
      notes: { user_id: user.id, plan_id: planId },
    }),
  })

  const subscription = await response.json()
  if (!response.ok) {
    return NextResponse.json({ error: subscription.error?.description ?? "Could not create subscription" }, { status: 502 })
  }

  return NextResponse.json({
    subscriptionId: subscription.id,
    keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
  })
}
