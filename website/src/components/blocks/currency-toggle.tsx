"use client"

import { useSyncExternalStore } from "react"
import { cn } from "@/lib/utils"
import { VIEW_COOKIE } from "@/lib/currency"
import type { Currency } from "@/lib/plans"

// India ₹ / International $ switch for comparing prices. It only changes
// which prices are shown (<html data-currency>); checkout still charges by
// the visitor's real country -- see lib/currency.ts.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-currency"] })
  return () => observer.disconnect()
}

const getViewed = () => (document.documentElement.dataset.currency === "USD" ? "USD" : "INR") as Currency
// Before hydration the server can't know; render neither as active.
const getServerViewed = () => null

function show(currency: Currency) {
  document.documentElement.dataset.currency = currency
  document.cookie = `${VIEW_COOKIE}=${currency}; path=/; samesite=lax`
}

const OPTIONS: { currency: Currency; label: string }[] = [
  { currency: "INR", label: "India ₹" },
  { currency: "USD", label: "International $" },
]

export function CurrencyToggle({ className }: { className?: string }) {
  const viewed = useSyncExternalStore(subscribe, getViewed, getServerViewed)

  return (
    <div role="group" aria-label="Show prices for" className={cn("inline-flex rounded-full border border-border bg-card p-1 text-sm", className)}>
      {OPTIONS.map((o) => (
        <button
          key={o.currency}
          type="button"
          aria-pressed={viewed === o.currency}
          onClick={() => show(o.currency)}
          className={cn(
            "rounded-full px-4 py-1.5 font-medium transition-colors",
            viewed === o.currency ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
