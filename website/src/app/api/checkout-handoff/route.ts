import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { PAID_PLAN_IDS, type PlanId } from "@/lib/plans"
import { PAYMENT_ORIGIN } from "@/lib/payment-domain"

// Razorpay only accepts payments from websites registered on the merchant
// account, and smallbirdai.com isn't approved yet (checkout from it fails with
// payment_risk_check_failed). Until it is, checkout runs on smallbird.in: this
// mints a one-time sign-in token via the dashboard-handoff Edge Function (the
// same one the desktop app's "Open Dashboard" uses) so the buyer lands on
// smallbird.in already signed in, at /pay with their plan picked.
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!user || !session) {
    return NextResponse.json({ error: "Please log in first" }, { status: 401 })
  }

  const { planId } = (await request.json()) as { planId?: PlanId }
  if (!planId || !PAID_PLAN_IDS.has(planId)) {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 })
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/dashboard-handoff`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    },
  })
  const data = (await response.json().catch(() => ({}))) as { tokenHash?: string }
  if (!response.ok || !data.tokenHash) {
    return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 502 })
  }

  const next = `/pay?plan=${encodeURIComponent(planId)}`
  const url = `${PAYMENT_ORIGIN}/auth/handoff?token_hash=${encodeURIComponent(data.tokenHash)}&next=${encodeURIComponent(next)}`
  return NextResponse.json({ url })
}
