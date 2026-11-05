"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { X } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { LiquidButton } from "@/components/ui/liquid-glass-button"
import type { SitePromotion } from "@/lib/live-pricing"

// Site announcements from public.site_promotions (a sale, a launch, any
// message), set from the admin console's Pricing & Offers page. Each one is
// dismissed per visitor by its id, so a new announcement shows again.

const DISMISSED_KEY = "smallbird:promo-dismissed"

function isDismissed(key: string): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY)?.split(",").includes(key) ?? false
  } catch {
    return false
  }
}

function dismiss(key: string) {
  try {
    const keys = localStorage.getItem(DISMISSED_KEY)?.split(",") ?? []
    localStorage.setItem(DISMISSED_KEY, [...keys, key].slice(-20).join(","))
  } catch {
    // Storage blocked: it just shows again next visit.
  }
}

// Treated as dismissed during server render, so a visitor who closed it
// doesn't see it flash before the browser's storage is read.
const noSubscribe = () => () => {}
function useDismissed(key: string): boolean {
  return useSyncExternalStore(noSubscribe, () => isDismissed(key), () => true)
}

export function PromoBanner({ promo }: { promo: SitePromotion | null }) {
  const key = promo ? `banner:${promo.id}` : ""
  const dismissed = useDismissed(key)
  const [closed, setClosed] = useState(false)

  if (!promo?.showBanner || dismissed || closed) return null

  return (
    <div className="relative bg-foreground px-10 py-2 text-center text-[13px] text-background sm:text-sm">
      <span className="font-semibold">{promo.title}</span>
      {promo.message ? <span className="opacity-80"> — {promo.message}</span> : null}
      {promo.ctaLabel && promo.ctaHref ? (
        <Link href={promo.ctaHref} className="ml-2 font-semibold underline underline-offset-2">
          {promo.ctaLabel}
        </Link>
      ) : null}
      <button
        type="button"
        aria-label="Close announcement"
        onClick={() => {
          dismiss(key)
          setClosed(true)
        }}
        className="absolute top-1/2 right-3 -translate-y-1/2 opacity-70 transition-opacity hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

export function PromoPopup({ promo }: { promo: SitePromotion | null }) {
  const key = promo ? `popup:${promo.id}` : ""
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!promo?.showPopup || isDismissed(key)) return
    // A moment after landing, so it doesn't fight the page for attention.
    const timer = setTimeout(() => setOpen(true), 1500)
    return () => clearTimeout(timer)
  }, [promo, key])

  if (!promo?.showPopup) return null

  const close = () => {
    dismiss(key)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center text-2xl">{promo.title}</DialogTitle>
          {promo.message ? <DialogDescription className="text-center">{promo.message}</DialogDescription> : null}
        </DialogHeader>
        {promo.ctaLabel && promo.ctaHref ? (
          <LiquidButton asChild className="w-full" onClick={close}>
            <Link href={promo.ctaHref}>{promo.ctaLabel}</Link>
          </LiquidButton>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
