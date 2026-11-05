"use client"

import Link from "next/link"
import { useSyncExternalStore } from "react"
import { ArrowRight } from "lucide-react"
import { LocalPrice } from "@/components/blocks/local-price"
import { usePromo } from "@/components/blocks/promo"
import { Diya, useFestivePreview } from "@/components/blocks/festive-effects"
import { useLiveSale } from "@/lib/pricing-context"

// The current offer at the top of the hero, in the space above the headline:
// sale name, best discount, a live countdown and a button to the passes.
// Only shown while a sale or an announcement is live (both set in the admin
// console's Pricing & Offers page); otherwise the hero is unchanged.

// Seconds since epoch, ticking every second -- null during server render, so
// the countdown only appears once the browser's clock is known.
function subscribeClock(onTick: () => void) {
  const id = setInterval(onTick, 1000)
  return () => clearInterval(id)
}
function useNow(): number | null {
  return useSyncExternalStore(subscribeClock, () => Math.floor(Date.now() / 1000), () => null)
}

function countdown(endsAt: string, now: number): string | null {
  const left = Math.floor(Date.parse(endsAt) / 1000) - now
  if (left <= 0) return null
  const d = Math.floor(left / 86400)
  const h = Math.floor((left % 86400) / 3600)
  const m = Math.floor((left % 3600) / 60)
  const s = left % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  return d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}h ${pad(m)}m ${pad(s)}s`
}

const STYLE: Record<string, string> = {
  diwali:
    "border-[#F59E0B]/50 bg-gradient-to-r from-[#FFF4E0] via-[#FFE8CC] to-[#FFE3EC] text-[#7C2D12] shadow-[0_8px_30px_-12px_rgba(234,88,12,0.45)]",
  newyear: "border-[#6366F1]/40 bg-gradient-to-r from-[#EEF2FF] to-[#FDF4FF] text-[#312E81]",
  confetti: "border-[#F72585]/30 bg-gradient-to-r from-[#EEF2FF] to-[#FFF0F6] text-[#3A0CA3]",
  none: "border-border bg-card text-foreground",
}

export function HeroOffer() {
  const promo = usePromo()
  const sale = useLiveSale()
  const preview = useFestivePreview()
  const now = useNow()

  if (!sale && !promo) return null

  const theme = preview ?? promo?.theme ?? "none"
  const title = sale?.label ?? promo?.title ?? ""
  const endsAt = sale?.endsAt ?? promo?.endsAt ?? null
  const left = endsAt && now ? countdown(endsAt, now) : null
  const href = sale ? "/pricing" : (promo?.ctaHref ?? "/pricing")
  const cta = sale ? "Grab the deal" : (promo?.ctaLabel ?? "See offers")

  return (
    <div className="relative z-10 -mt-4 mb-8 flex justify-center md:-mt-12 md:mb-10">
      <Link
        href={href}
        className={`festive-shimmer group relative flex max-w-3xl flex-wrap items-center justify-center gap-x-4 gap-y-2 overflow-hidden rounded-2xl border px-5 py-3 text-center transition-transform hover:-translate-y-0.5 sm:flex-nowrap sm:rounded-full sm:py-2.5 sm:text-left ${STYLE[theme] ?? STYLE.none}`}
      >
        {theme === "diwali" ? <Diya size={30} className="hidden shrink-0 sm:block" /> : null}
        <span className="text-sm font-bold sm:text-base">{title}</span>
        <span className="text-sm">
          {sale ? (
            <LocalPrice
              inr={sale.inrPercent ? <>Up to <strong>{sale.inrPercent}% off</strong> all passes</> : "Special prices on passes"}
              usd={sale.usdPercent ? <>Up to <strong>{sale.usdPercent}% off</strong> all passes</> : "Special prices on passes"}
            />
          ) : (
            promo?.message
          )}
        </span>
        {left ? (
          <span className="rounded-full bg-black/5 px-2.5 py-0.5 font-mono text-xs font-semibold tabular-nums">
            Ends in {left}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1 text-sm font-semibold underline-offset-2 group-hover:underline">
          {cta}
          <ArrowRight className="h-4 w-4" />
        </span>
      </Link>
    </div>
  )
}
