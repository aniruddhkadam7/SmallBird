import type { ReactNode } from "react"
import { LiquidGlassContainer } from "@/components/ui/liquid-glass-container"
import { cn } from "@/lib/utils"

// A fixed-size box so a media panel stays the same size no matter which gif
// is showing or what aspect ratio it happens to have. `className` overrides
// the default height (e.g. a taller box for a hero-style demo).
export function GifWindowFrame({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <LiquidGlassContainer
      rounded="rounded-xl"
      className={cn("h-72 overflow-hidden sm:h-96", className)}
      contentClassName="relative h-full"
      style={{ backgroundColor: "rgba(148,148,148,0.35)" }}
    >
      {children}
    </LiquidGlassContainer>
  )
}
