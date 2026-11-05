import { PLANS, type Currency, type PlanId } from "@/lib/plans"
import { FESTIVE_THEMES, type FestiveTheme } from "@/lib/festive"

// Live prices, sales and site announcements, read from Supabase so they can
// be changed from the admin console's Pricing & Offers page without a
// website deploy (backend migration 0066). If the read fails, the prices in
// lib/plans.ts are used -- the webhook always accepts those, so checkout
// keeps working.

export interface LiveSale {
  inr: number | null
  usd: number | null
  label: string | null
  // Pre-formatted on the server ("Ends 10 Nov") so client and server render
  // the same text.
  endsLabel: string | null
  endsAt: string | null
}

export interface LivePlan {
  regular: { inr: number; usd: number }
  sale: LiveSale | null
}

export type LivePricing = Record<PlanId, LivePlan>

export interface SitePromotion {
  id: string
  title: string
  message: string | null
  ctaLabel: string | null
  ctaHref: string | null
  showBanner: boolean
  showPopup: boolean
  theme: FestiveTheme
  endsAt: string | null
}

// Pages refresh their copy at most this often, so a change shows up on the
// site within about a minute.
const REVALIDATE_SECONDS = 60

const REST_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
// A slow database must never hold a page up; the fallback prices are fine.
const TIMEOUT_MS = 5000

interface PlanRow {
  id: PlanId
  price_inr_paise: number
  price_usd_cents: number
  sale_price_inr_paise: number | null
  sale_price_usd_cents: number | null
  sale_label: string | null
  sale_starts_at: string | null
  sale_ends_at: string | null
}

interface PromotionRow {
  id: string
  title: string
  message: string | null
  cta_label: string | null
  cta_href: string | null
  show_banner: boolean
  show_popup: boolean
  // Added in migration 0067; absent before it runs.
  theme?: string | null
  starts_at: string
  ends_at: string | null
}

function staticPricing(): LivePricing {
  return Object.fromEntries(
    PLANS.map((p) => [p.id, { regular: { inr: p.priceInPaise, usd: p.usd.cents }, sale: null }]),
  ) as LivePricing
}

function isLive(startsAt: string | null, endsAt: string | null, now: number): boolean {
  return (!startsAt || Date.parse(startsAt) <= now) && (!endsAt || Date.parse(endsAt) > now)
}

function endsLabel(endsAt: string | null): string | null {
  if (!endsAt) return null
  const date = new Date(endsAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })
  return `Ends ${date}`
}

/// `fresh` skips the cache -- for checkout, which must charge today's price.
export async function getLivePricing({ fresh = false }: { fresh?: boolean } = {}): Promise<LivePricing> {
  const pricing = staticPricing()
  try {
    const res = await fetch(
      `${REST_URL}/plans?select=id,price_inr_paise,price_usd_cents,sale_price_inr_paise,sale_price_usd_cents,sale_label,sale_starts_at,sale_ends_at`,
      fresh
        ? { headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) }
        : { headers, next: { revalidate: REVALIDATE_SECONDS }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    )
    if (!res.ok) return pricing
    const rows = (await res.json()) as PlanRow[]
    const now = Date.now()
    for (const row of rows) {
      if (!(row.id in pricing)) continue
      const onSale =
        (row.sale_price_inr_paise || row.sale_price_usd_cents) && isLive(row.sale_starts_at, row.sale_ends_at, now)
      pricing[row.id] = {
        regular: { inr: row.price_inr_paise, usd: row.price_usd_cents },
        sale: onSale
          ? {
              inr: row.sale_price_inr_paise,
              usd: row.sale_price_usd_cents,
              label: row.sale_label,
              endsLabel: endsLabel(row.sale_ends_at),
              endsAt: row.sale_ends_at,
            }
          : null,
      }
    }
  } catch {
    // Network or schema error: keep the built-in prices.
  }
  return pricing
}

/// What a plan costs right now, in the currency's smallest unit.
export function currentAmount(plan: LivePlan, currency: Currency): number {
  return currency === "USD" ? (plan.sale?.usd ?? plan.regular.usd) : (plan.sale?.inr ?? plan.regular.inr)
}

/// The newest announcement that is live now, if any.
export async function getActivePromotion(): Promise<SitePromotion | null> {
  try {
    const res = await fetch(`${REST_URL}/site_promotions?select=*&order=created_at.desc&limit=10`, {
      headers,
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const rows = (await res.json()) as PromotionRow[]
    const now = Date.now()
    const row = rows.find((r) => isLive(r.starts_at, r.ends_at, now))
    if (!row) return null
    return {
      id: row.id,
      title: row.title,
      message: row.message,
      ctaLabel: row.cta_label,
      ctaHref: row.cta_href,
      showBanner: row.show_banner,
      showPopup: row.show_popup,
      theme: FESTIVE_THEMES.includes(row.theme as FestiveTheme) ? (row.theme as FestiveTheme) : "none",
      endsAt: row.ends_at,
    }
  } catch {
    return null
  }
}
