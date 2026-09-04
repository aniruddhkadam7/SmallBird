import Link from "next/link"
import { ArrowRight, Download } from "lucide-react"
import { LiquidButton } from "@/components/ui/liquid-glass-button"

export function CtaBanner() {
  return (
    <section className="mx-auto mt-16 max-w-3xl px-4 pb-16 sm:pb-24">
      <div className="glass flex flex-col items-center gap-4 rounded-2xl border border-border px-6 py-10 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">Try Smallbird free</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          10 minutes a month at no cost, no card required. See how it feels before your next interview.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <LiquidButton size="lg" asChild>
            <Link href="/download">
              <Download className="h-4 w-4" />
              Download for free
            </Link>
          </LiquidButton>
          <LiquidButton size="lg" variant="outline" asChild>
            <Link href="/pricing">
              See pricing
              <ArrowRight className="h-4 w-4" />
            </Link>
          </LiquidButton>
        </div>
      </div>
    </section>
  )
}
