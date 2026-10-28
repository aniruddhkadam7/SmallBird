"use client"

import { ArrowRight } from "lucide-react"
import { LiquidButton } from "@/components/ui/liquid-glass-button"
import { usePurchaseFlow } from "@/lib/purchase-flow"

// Signed in: straight to the Resumes tab. Otherwise the site's one sign-up
// dialog, which then lands them on the same tab.
export function StartResumeButton({ label = "Build my resume — free" }: { label?: string }) {
  const { requestPageAccess } = usePurchaseFlow()
  return (
    <LiquidButton size="lg" onClick={() => requestPageAccess("/dashboard?view=resumes", "signup")}>
      {label}
      <ArrowRight className="h-4 w-4" />
    </LiquidButton>
  )
}
