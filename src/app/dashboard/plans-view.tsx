"use client"

import { Check } from "lucide-react"
import { PLANS, type PlanId } from "@/lib/plans"
import { usePurchaseFlow } from "@/lib/purchase-flow"
import { LiquidButton } from "@/components/ui/liquid-glass-button"
import { LocalPrice } from "@/components/blocks/local-price"
import { CurrencyToggle } from "@/components/blocks/currency-toggle"

// The three real paid plans from lib/plans.ts (skips "free" -- someone
// viewing this is already on it). startFlow() reuses the exact same
// Razorpay checkout the marketing site's pricing section triggers; since
// the dashboard is only ever reached signed in, it jumps straight to the
// payment step rather than asking to sign up first.
const UPGRADE_PLAN_IDS: PlanId[] = ["starter", "pro", "pro-plus"]

export function PlansView() {
  const { startFlow } = usePurchaseFlow()
  const plans = UPGRADE_PLAN_IDS.map((id) => PLANS.find((p) => p.id === id)!)

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Upgrade</h1>
      <p className="mt-1 text-sm text-muted-foreground">Choose a plan to keep going once your free minutes run out.</p>
      <CurrencyToggle className="mt-4" />

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`flex flex-col gap-4 rounded-xl border p-5 ${
              plan.recommended ? "border-primary bg-primary/5" : "border-border bg-card"
            }`}
          >
            <div>
              {plan.recommended && (
                <span className="mb-2 inline-block rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                  Best value
                </span>
              )}
              <div className="font-semibold text-foreground">{plan.name}</div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-2xl font-semibold text-foreground"><LocalPrice inr={plan.price} usd={plan.usd.price} /></span>
                {plan.cadence && <span className="text-sm text-muted-foreground">{plan.cadence}</span>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground"><LocalPrice inr={plan.billingNote} usd={plan.usd.billingNote} /></p>
            </div>

            <ul className="flex flex-1 flex-col gap-2">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm text-foreground">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  {feature}
                </li>
              ))}
            </ul>

            <LiquidButton onClick={() => startFlow(plan.id)} className="w-full">
              {plan.cta}
            </LiquidButton>
          </div>
        ))}
      </div>
    </div>
  )
}
