"use client"

import type { ReactNode } from "react"
import { ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Glow } from "@/components/ui/glow"

interface HeroWithMockupProps {
  eyebrow?: string
  title: string
  description: string
  primaryCta?: {
    text: string
    href: string
  }
  secondaryCta?: {
    text: string
    href: string
  }
  mockup: ReactNode
  className?: string
}

export function HeroWithMockup({
  eyebrow,
  title,
  description,
  primaryCta = { text: "Get Started", href: "#get-started" },
  secondaryCta = { text: "See how it works", href: "#product-demo" },
  mockup,
  className,
}: HeroWithMockupProps) {
  return (
    <section
      className={cn(
        "relative bg-background text-foreground",
        "py-16 px-4 md:py-24 lg:py-28",
        "overflow-hidden",
        className,
      )}
    >
      <div className="relative mx-auto flex max-w-5xl flex-col gap-12 lg:gap-20">
        <div className="relative z-10 flex flex-col items-center gap-6 text-center lg:gap-8">
          {eyebrow ? (
            <Badge
              variant="outline"
              className="animate-appear px-3 py-1 text-xs tracking-wide text-muted-foreground opacity-0 [animation-delay:0ms]"
            >
              {eyebrow}
            </Badge>
          ) : null}

          <h1
            className={cn(
              "inline-block animate-appear opacity-0 [animation-delay:80ms]",
              "text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl",
              "leading-[1.1]",
              "text-foreground",
            )}
          >
            {title}
          </h1>

          <p
            className={cn(
              "max-w-[620px] animate-appear opacity-0 [animation-delay:200ms]",
              "text-base sm:text-lg",
              "text-muted-foreground",
            )}
          >
            {description}
          </p>

          <div className="relative z-10 flex flex-wrap items-center justify-center gap-3 animate-appear opacity-0 [animation-delay:320ms]">
            <button
              type="button"
              onClick={() => {
                window.location.href = primaryCta.href
              }}
              className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background shadow-[0_8px_20px_rgba(0,0,0,0.12)] transition-transform hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(0,0,0,0.16)]"
            >
              {primaryCta.text}
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = secondaryCta.href
              }}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-6 py-3 text-sm font-semibold text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-transform hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.1)]"
            >
              {secondaryCta.text}
            </button>
          </div>

          <div className="animate-appear relative w-full max-w-3xl pt-10 opacity-0 [animation-delay:480ms]">
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
