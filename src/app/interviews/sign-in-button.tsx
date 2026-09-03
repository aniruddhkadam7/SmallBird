"use client"

import { LiquidButton } from "@/components/ui/liquid-glass-button"
import { usePurchaseFlow } from "@/lib/purchase-flow"

// Same "free" flow the old download-gate button used — signing in doesn't
// require picking a paid plan, every account gets the free plan
// automatically.
export function SignInButton() {
  const { startFlow } = usePurchaseFlow()
  return (
    <LiquidButton onClick={() => startFlow("free")}>
      Sign in to view your interviews
    </LiquidButton>
  )
}
