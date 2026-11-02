import type { Currency } from "@/lib/plans"

// Who pays in which currency: India (or an unknown country, e.g. local dev)
// pays INR, everyone else USD. The country comes from Vercel's
// x-vercel-ip-country header. create-order decides the charged currency from
// that header on the server, so a buyer can't pick the cheaper one; the
// middleware copies the same country into COUNTRY_COOKIE so pages can show
// the matching prices.
export const COUNTRY_COOKIE = "sb_country"

export function currencyForCountry(country: string | null | undefined): Currency {
  return !country || country.toUpperCase() === "IN" ? "INR" : "USD"
}

// Runs inline in <head> before first paint: marks <html data-currency> from
// the cookie, and globals.css hides the other currency's prices. Pages are
// static, so the HTML holds both and this picks one with no ₹-then-$ flash.
export const currencyScript = `try{var m=document.cookie.match(/(?:^|; )${COUNTRY_COOKIE}=([A-Za-z]{2})/);document.documentElement.dataset.currency=m&&m[1].toUpperCase()!=="IN"?"USD":"INR"}catch(e){}`
