import type { ReactNode } from "react"

// Shows `inr` to visitors in India and `usd` to everyone else. Both are in
// the HTML; <html data-currency> (set before paint by lib/currency.ts's
// script) and globals.css hide the other one.
export function LocalPrice({ inr, usd }: { inr: ReactNode; usd: ReactNode }) {
  return (
    <>
      <span className="only-inr">{inr}</span>
      <span className="only-usd">{usd}</span>
    </>
  )
}
