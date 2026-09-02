"use client"

import { Download } from "lucide-react"
import { LiquidButton } from "@/components/ui/liquid-glass-button"
import { usePurchaseFlow } from "@/lib/purchase-flow"

// Not logged in yet: opens the same login flow used from pricing, defaulted
// to the free plan (an account is required to download regardless of plan
// — every signup gets a free entitlement automatically).
export function DownloadGateButton() {
  const { startFlow } = usePurchaseFlow()
  return (
    <LiquidButton className="w-full" onClick={() => startFlow("free")}>
      <Download className="h-4 w-4" />
      Sign in to download
    </LiquidButton>
  )
}
