import type { ReactNode } from "react"

// Shows `inr` or `usd` by the currency being viewed (<html data-currency>:
// the visitor's country unless they used the India/International toggle).
// Both are in the HTML; lib/currency.ts's script sets the attribute before
// paint and globals.css hides the other one.
//
// `charged` follows the visitor's real country instead (<html
// data-home-currency>), ignoring the toggle -- for the payment step, which
// must show what will actually be charged.
export function LocalPrice({ inr, usd, charged }: { inr: ReactNode; usd: ReactNode; charged?: boolean }) {
  return (
    <>
      <span className={charged ? "home-inr" : "only-inr"}>{inr}</span>
      <span className={charged ? "home-usd" : "only-usd"}>{usd}</span>
    </>
  )
}
