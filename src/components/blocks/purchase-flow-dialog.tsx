"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { LiquidButton } from "@/components/ui/liquid-glass-button"
import { PLAN_LABELS, usePurchaseFlow } from "@/lib/purchase-flow"
import { getPlan } from "@/lib/plans"

export function PurchaseFlowDialog() {
  const { activeFlow, closeFlow, requestCode, verifyCode, signInWithGoogle, completePayment, busy, error } = usePurchaseFlow()
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const router = useRouter()

  if (!activeFlow) return null

  const plan = getPlan(activeFlow.plan)
  const planLabel = PLAN_LABELS[activeFlow.plan]
  const priceSummary = plan.cadence ? `${plan.price} ${plan.cadence}` : `${plan.price} — no payment needed`

  return (
    <Dialog open onOpenChange={(open) => !open && closeFlow()}>
      <DialogContent className="sm:max-w-md">
        {activeFlow.step === "signup" ? (
          <>
            <DialogHeader>
              <DialogTitle>Log in or sign up</DialogTitle>
              <DialogDescription>
                Continuing with <span className="font-medium text-foreground">{planLabel}</span> ({priceSummary}).
                We'll email you a 6-digit code — no password needed.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                requestCode(email)
              }}
            >
              <div className="space-y-1.5">
                <label htmlFor="signup-email" className="text-sm font-medium text-foreground">
                  Email address
                </label>
                <input
                  id="signup-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <LiquidButton type="submit" className="w-full" disabled={busy}>
                  {busy ? "Sending code…" : "Send code"}
                </LiquidButton>
              </DialogFooter>
            </form>
            <div className="relative py-1 text-center text-xs text-muted-foreground">
              <span className="relative bg-background px-2">or</span>
              <div className="absolute inset-x-0 top-1/2 -z-10 border-t border-border" />
            </div>
            <LiquidButton variant="outline" className="w-full" onClick={signInWithGoogle} disabled={busy}>
              Continue with Google
            </LiquidButton>
          </>
        ) : null}

        {activeFlow.step === "verify" ? (
          <>
            <DialogHeader>
              <DialogTitle>Enter your code</DialogTitle>
              <DialogDescription>We sent a 6-digit code to {email}.</DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                verifyCode(email, code)
              }}
            >
              <div className="space-y-1.5">
                <label htmlFor="verify-code" className="text-sm font-medium text-foreground">
                  Code
                </label>
                <input
                  id="verify-code"
                  type="text"
                  inputMode="numeric"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <LiquidButton type="submit" className="w-full" disabled={busy}>
                  {busy ? "Verifying…" : "Verify"}
                </LiquidButton>
              </DialogFooter>
            </form>
          </>
        ) : null}

        {activeFlow.step === "payment" ? (
          <>
            <DialogHeader>
              <DialogTitle>Payment</DialogTitle>
              <DialogDescription>
                {planLabel} — {priceSummary}
              </DialogDescription>
            </DialogHeader>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <LiquidButton className="w-full" onClick={completePayment} disabled={busy}>
                {busy ? "Opening checkout…" : "Continue to payment"}
              </LiquidButton>
            </DialogFooter>
          </>
        ) : null}

        {activeFlow.step === "done" ? (
          <>
            <DialogHeader>
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-foreground/5">
                <CheckCircle2 className="h-6 w-6 text-foreground" />
              </div>
              <DialogTitle className="text-center">You're all set</DialogTitle>
              <DialogDescription className="text-center">
                {planLabel} is ready. Download Smallbird for Windows to get started.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <LiquidButton
                className="w-full"
                onClick={() => {
                  closeFlow()
                  router.push("/download")
                }}
              >
                Go to download
              </LiquidButton>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
