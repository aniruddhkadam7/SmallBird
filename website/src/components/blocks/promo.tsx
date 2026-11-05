"use client"

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import Link from "next/link"
import { X } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { LiquidButton } from "@/components/ui/liquid-glass-button"
import type { SitePromotion } from "@/lib/live-pricing"
import { Diya, MarigoldStrip, useFestivePreview } from "@/components/blocks/festive-effects"

// Site announcements from public.site_promotions (a sale, a launch, any
// message), set from the admin console's Pricing & Offers page. Each one is
// dismissed per visitor by its id, so a new announcement shows again.

const DISMISSED_KEY = "smallbird:promo-dismissed"

// The live announcement, for parts of the page that echo it (the hero's
// offer card). Set in the marketing layout.
const PromoContext = createContext<SitePromotion | null>(null)

export function PromoProvider({ promo, children }: { promo: SitePromotion | null; children: ReactNode }) {
  return <PromoContext.Provider value={promo}>{children}</PromoContext.Provider>
}

export function usePromo(): SitePromotion | null {
  return useContext(PromoContext)
}

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

// Banner colours per festive theme.
const BANNER_STYLE: Record<string, string> = {
  none: "bg-foreground text-background",
  diwali: "bg-gradient-to-r from-[#7c2d12] via-[#c2410c] to-[#9d174d] text-[#FFF4D6]",
  newyear: "bg-gradient-to-r from-[#0f172a] via-[#312e81] to-[#0f172a] text-[#FDE68A]",
  confetti: "bg-gradient-to-r from-[#4361EE] via-[#7209B7] to-[#F72585] text-white",
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
  const theme = useFestivePreview() ?? promo?.theme ?? "none"

  if (!promo?.showBanner || dismissed || closed) return null

  return (
    <div
      className={`relative overflow-hidden px-10 py-2 text-center text-[13px] sm:text-sm ${BANNER_STYLE[theme] ?? BANNER_STYLE.none} ${
        theme === "none" ? "" : "festive-shimmer"
      }`}
    >
      {theme === "diwali" ? <Diya size={22} className="mr-2 inline-block align-[-5px]" /> : null}
      <span className="font-semibold">{promo.title}</span>
      {promo.message ? <span className="hidden opacity-80 sm:inline"> — {promo.message}</span> : null}
      {promo.ctaLabel && promo.ctaHref ? (
        <Link href={promo.ctaHref} className="ml-2 font-semibold underline underline-offset-2">
          {promo.ctaLabel}
        </Link>
      ) : null}
      {theme === "diwali" ? <Diya size={22} delay={0.5} className="ml-2 inline-block align-[-5px]" /> : null}
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
  const theme = useFestivePreview() ?? promo?.theme ?? "none"
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
      <DialogContent
        className={`w-[calc(100%-2rem)] sm:max-w-md ${
          theme === "diwali"
            ? "overflow-hidden border-[#F59E0B]/50 bg-gradient-to-b from-[#FFF4E0] via-[#FFF8EE] to-[#FFE3EC] pt-0"
            : ""
        }`}
      >
        {theme === "diwali" ? (
          <div className="-mx-6 mb-1 min-w-0 overflow-hidden">
            <MarigoldStrip />
            <div className="mt-2 flex justify-center">
              <Diya size={64} />
            </div>
          </div>
        ) : null}
        <DialogHeader>
          <DialogTitle className={`text-center text-2xl ${theme === "diwali" ? "text-[#7C2D12]" : ""}`}>{promo.title}</DialogTitle>
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
