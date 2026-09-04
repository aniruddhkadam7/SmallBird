"use client"

import type { ReactNode } from "react"
import { ArrowRight, Play } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Glow } from "@/components/ui/glow"
import { LiquidButton } from "@/components/ui/liquid-glass-button"

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
  primaryCta = { text: "Dashboard", href: "/dashboard" },
  secondaryCta = { text: "Demo", href: "#product-demo" },
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
      <div className="relative mx-auto max-w-7xl">
        <div className="relative z-10 grid gap-10 md:grid-cols-[1fr_1.2fr] md:items-center md:gap-8">
          <div className="flex flex-col items-center gap-5 text-center md:items-start md:gap-6 md:text-left">
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
                "text-3xl font-semibold tracking-tight sm:text-4xl md:text-3xl lg:text-4xl xl:text-5xl 2xl:text-6xl",
                "leading-[1.1]",
                "text-foreground",
              )}
            >
              {title}
            </h1>

            <p
              className={cn(
                "max-w-[480px] animate-appear opacity-0 [animation-delay:200ms]",
                "text-base sm:text-lg",
                "text-muted-foreground",
              )}
            >
              {description}
            </p>

            <div className="relative z-10 flex flex-wrap items-center justify-center gap-3 animate-appear opacity-0 [animation-delay:320ms] md:justify-start">
              <LiquidButton
                size="lg"
                className="bg-green-200 hover:bg-green-300"
                onClick={() => {
                  window.location.href = primaryCta.href
                }}
              >
                {primaryCta.text}
                <ArrowRight className="h-4 w-4" />
              </LiquidButton>
              <LiquidButton
                size="lg"
                variant="outline"
                onClick={() => {
                  window.location.href = secondaryCta.href
                }}
              >
                <Play className="h-4 w-4 fill-current" />
                {secondaryCta.text}
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
