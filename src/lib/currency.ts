import type { Currency } from "@/lib/plans"

// Who pays in which currency: India (or an unknown country, e.g. local dev)
// pays INR, everyone else USD. The country comes from Vercel's
// x-vercel-ip-country header. create-order decides the charged currency from
// that header on the server, so a buyer can't pick the cheaper one; the
// middleware copies the same country into COUNTRY_COOKIE so pages can show
// the matching prices.
export const COUNTRY_COOKIE = "sb_country"

// The India ₹ / International $ toggle (components/blocks/currency-toggle.tsx)
// only changes which prices are *shown*. Session cookie, so a visitor who
// peeked at the other prices gets their own country's again next visit.
export const VIEW_COOKIE = "sb_currency_view"

export function currencyForCountry(country: string | null | undefined): Currency {
  return !country || country.toUpperCase() === "IN" ? "INR" : "USD"
}

// Runs inline in <head> before first paint. Sets two attributes on <html>:
//   data-home-currency  what this visitor is charged (from their country)
//   data-currency       what prices are shown (the toggle, else home)
// globals.css hides the other currency's prices. Pages are static, so the
// HTML holds both and this picks one with no ₹-then-$ flash.
export const currencyScript = `try{var c=document.cookie,m=c.match(/(?:^|; )${COUNTRY_COOKIE}=([A-Za-z]{2})/),v=c.match(/(?:^|; )${VIEW_COOKIE}=(INR|USD)/),h=m&&m[1].toUpperCase()!=="IN"?"USD":"INR",d=document.documentElement.dataset;d.homeCurrency=h;d.currency=v?v[1]:h}catch(e){}`
