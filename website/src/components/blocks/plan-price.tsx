"use client"

import { LocalPrice } from "@/components/blocks/local-price"
import { usePlanPrice, type DisplayPrice } from "@/lib/pricing-context"
import type { PlanId } from "@/lib/plans"

function Amount({ price }: { price: DisplayPrice }) {
  return (
    <>
      {price.now}
      {price.was ? (
        <s className="ml-2 align-middle text-base font-normal text-muted-foreground">{price.was}</s>
      ) : null}
    </>
  )
}

function Sale({ price }: { price: DisplayPrice }) {
  if (!price.saleLabel) return null
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
      {price.saleLabel}
      {price.saleEnds ? <span className="font-normal text-primary/80">· {price.saleEnds}</span> : null}
    </span>
  )
}

/// The plan's current price (sale price with the regular one struck through
/// while a sale is on), in the currency being viewed.
export function PlanAmount({ id }: { id: PlanId }) {
  const { inr, usd } = usePlanPrice(id)
  return <LocalPrice inr={<Amount price={inr} />} usd={<Amount price={usd} />} />
}

/// "60 minutes · ₹4.98/min" for the price being shown.
export function PlanNote({ id }: { id: PlanId }) {
  const { inr, usd } = usePlanPrice(id)
  return <LocalPrice inr={inr.note} usd={usd.note} />
}

/// The sale label ("🪔 Diwali Sale · Ends 10 Nov"), only while on sale.
export function PlanSaleBadge({ id }: { id: PlanId }) {
  const { inr, usd } = usePlanPrice(id)
  if (!inr.saleLabel && !usd.saleLabel) return null
  return <LocalPrice inr={<Sale price={inr} />} usd={<Sale price={usd} />} />
}
