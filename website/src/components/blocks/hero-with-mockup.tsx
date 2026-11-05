"use client"

import type { ReactNode } from "react"
import { ArrowRight, Smartphone } from "lucide-react"
import { cn } from "@/lib/utils"
import { Glow } from "@/components/ui/glow"
import { LiquidButton } from "@/components/ui/liquid-glass-button"
import { usePurchaseFlow } from "@/lib/purchase-flow"
import { SocialProof } from "@/components/blocks/social-proof"
import { HeroOffer } from "@/components/blocks/hero-offer"

interface HeroWithMockupProps {
  title: string
  // Leading phrase of `title` kept on its own line on phones.
  titleHighlight?: string
  // Brand name shown as a small line at the top of the h1, so the page's
  // main heading carries the brand for search engines.
  brand?: string
  description: string
  primaryCta?: {
    text: string
    href: string
  }
  mockup: ReactNode
  className?: string
}

export function HeroWithMockup({
  title,
  titleHighlight,
  brand,
  description,
  primaryCta = { text: "Dashboard", href: "/dashboard" },
  mockup,
  className,
}: HeroWithMockupProps) {
  const { requestDashboardAccess, requestPageAccess } = usePurchaseFlow()
  const highlightAt = titleHighlight ? title.indexOf(titleHighlight) : -1

  return (
    <section
      className={cn(
        "relative bg-background text-foreground",
        "pt-10 pb-12 px-4 md:py-24 lg:py-28",
        // A soft brand-tinted wash behind the hero.
        "bg-[linear-gradient(180deg,var(--background)_0%,#eef2ff_18%,#f5f3ff_60%,var(--background)_100%)]",
        "overflow-hidden",
        className,
      )}
    >
      <div className="relative mx-auto max-w-7xl">
        <HeroOffer />
        <div className="relative z-10 grid gap-10 md:grid-cols-[1fr_1.2fr] md:items-center md:gap-8">
          <div className="flex flex-col items-center gap-5 text-center md:items-start md:gap-6 md:text-left">
            <SocialProof className="animate-appear opacity-0 [animation-delay:0ms]" />

            <h1
              className={cn(
                "inline-block animate-appear opacity-0 [animation-delay:80ms]",
                "text-[min(8vw,2rem)] font-bold tracking-tighter text-balance sm:text-4xl md:text-3xl md:font-semibold md:tracking-tight lg:text-4xl xl:text-5xl 2xl:text-6xl",
                "leading-[1.1]",
                "text-foreground",
              )}
            >
              {brand ? (
                <span className="mb-2 block text-sm font-semibold tracking-wide text-primary sm:text-base">{brand}</span>
              ) : null}
              {highlightAt >= 0 && titleHighlight ? (
                <>
                  {title.slice(0, highlightAt)}
                  {titleHighlight}
                  {/* Phones: the highlighted phrase (and its trailing comma)
                      gets its own line so the headline never breaks mid-phrase. */}
                  {title.slice(highlightAt + titleHighlight.length).startsWith(",") ? (
                    <>
                      ,<br className="md:hidden" />
                      {/* Non-breaking last space: no lone final word. */}
                      {title.slice(highlightAt + titleHighlight.length + 1).replace(/ (\S+)$/, "\u00a0$1")}
                    </>
                  ) : (
                    title.slice(highlightAt + titleHighlight.length)
                  )}
                </>
              ) : (
                title
              )}
            </h1>

            <p
              className={cn(
                "max-w-[480px] animate-appear opacity-0 [animation-delay:200ms]",
                "text-[15px] leading-relaxed sm:text-lg",
                "text-muted-foreground",
              )}
            >
              {description}
            </p>

            <div className="relative z-10 flex flex-nowrap items-center justify-center gap-2 max-[359px]:gap-1 animate-appear opacity-0 [animation-delay:320ms] sm:gap-3 md:flex-wrap md:justify-start">
              <LiquidButton
                size="lg"
                className="max-[359px]:gap-1.5 max-[359px]:text-[13px] max-sm:px-3.5 max-sm:has-[>svg]:px-3.5 max-[359px]:px-3 max-[359px]:has-[>svg]:px-3"
                onClick={() => {
                  if (primaryCta.href === "/dashboard") {
                    requestDashboardAccess()
                  } else {
                    window.location.href = primaryCta.href
                  }
                }}
              >
                {primaryCta.text}
                <ArrowRight className="h-4 w-4" />
              </LiquidButton>
              {/* The phone version needs no install: same account, opens /mobile
                  (signed-out visitors are asked to log in first, then land there). */}
              <LiquidButton size="lg" variant="outline" className="max-[359px]:gap-1.5 max-[359px]:text-[13px] max-sm:px-3.5 max-sm:has-[>svg]:px-3.5 max-[359px]:px-3 max-[359px]:has-[>svg]:px-3" onClick={() => requestPageAccess("/mobile")}>
                <Smartphone className="h-4 w-4" />
                Use on your phone
              </LiquidButton>
            </div>
          </div>

          <div className="animate-appear relative w-full opacity-0 [animation-delay:480ms]">
            {mockup}
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <Glow variant="above" className="opacity-60" />
      </div>
    </section>
  )
}
