"use client"

import { createContext, useContext, type ReactNode } from "react"
import { getPlan, type Plan, type PlanId } from "@/lib/plans"
import type { LivePricing } from "@/lib/live-pricing"

// Hands the live prices (read on the server in the root layout) to the
// client components that show them: the pricing section, the dashboard's
// upgrade view and the payment dialog.

const PricingContext = createContext<LivePricing | null>(null)

export function PricingProvider({ pricing, children }: { pricing: LivePricing; children: ReactNode }) {
  return <PricingContext.Provider value={pricing}>{children}</PricingContext.Provider>
}

export interface DisplayPrice {
  /// What it costs now ("₹209").
  now: string
  /// The regular price, struck through, while on sale.
  was: string | null
  note: string
  saleLabel: string | null
  saleEnds: string | null
}

export function formatInr(paise: number): string {
  const rupees = paise / 100
  return `₹${Number.isInteger(rupees) ? rupees : rupees.toFixed(2)}`
}

export function formatUsd(cents: number): string {
  const dollars = cents / 100
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`
}

function minutesOf(plan: Plan): number {
  return Number(plan.billingNote.match(/^(\d+) minutes/)?.[1] ?? 0)
}

function display(plan: Plan, currency: "INR" | "USD", pricing: LivePricing | null): DisplayPrice {
  const inr = currency === "INR"
  const live = pricing?.[plan.id]
  const regular = live ? (inr ? live.regular.inr : live.regular.usd) : inr ? plan.priceInPaise : plan.usd.cents
  const saleAmount = live?.sale ? (inr ? live.sale.inr : live.sale.usd) : null
  const amount = saleAmount ?? regular
  const format = inr ? formatInr : formatUsd
  const staticAmount = inr ? plan.priceInPaise : plan.usd.cents
  const staticNote = inr ? plan.billingNote : plan.usd.billingNote
  const minutes = minutesOf(plan)
  // Keep the hand-written note at the usual price; otherwise work out the
  // per-minute cost of what's actually charged.
  const note =
    amount === staticAmount || !minutes
      ? staticNote
      : `${minutes} minutes · ${inr ? "₹" : "$"}${(amount / 100 / minutes).toFixed(inr ? 2 : 3).replace(/0$/, "")}/min`
  return {
    now: format(amount),
    was: saleAmount !== null && saleAmount !== regular ? format(regular) : null,
    note,
    saleLabel: saleAmount !== null ? (live?.sale?.label ?? "Sale") : null,
    saleEnds: saleAmount !== null ? (live?.sale?.endsLabel ?? null) : null,
  }
}

/// Prices to show for a plan, in both currencies (LocalPrice picks one).
export function usePlanPrice(id: PlanId): { inr: DisplayPrice; usd: DisplayPrice } {
  const pricing = useContext(PricingContext)
  const plan = getPlan(id)
  return { inr: display(plan, "INR", pricing), usd: display(plan, "USD", pricing) }
}
