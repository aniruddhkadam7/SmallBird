"use client"

import { useState } from "react"
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
import { DownloadNextSteps } from "@/components/blocks/download-next-steps"
import { LocalPrice } from "@/components/blocks/local-price"

// Google's official four-color "G" logomark, per their brand guidelines for
// "Continue with Google" buttons — an inline SVG rather than an image file
// so it stays crisp at any size with no extra network request.
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82Z"
        fill="#4285F4"
      />
      <path
        d="M12 24c3.24 0 5.95-1.07 7.94-2.91l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.76-2.11-6.71-4.94H1.28v3.1A12 12 0 0 0 12 24Z"
        fill="#34A853"
      />
      <path
        d="M5.29 14.3a7.2 7.2 0 0 1 0-4.6v-3.1H1.28a12 12 0 0 0 0 10.8l4.01-3.1Z"
        fill="#FBBC05"
      />
      <path
        d="M12 4.75c1.76 0 3.35.61 4.6 1.8l3.44-3.44C17.94 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.6l4.01 3.1C6.24 6.86 8.88 4.75 12 4.75Z"
        fill="#EA4335"
      />
    </svg>
  )
}

export function PurchaseFlowDialog() {
  const {
    activeFlow,
    closeFlow,
    email: accountEmail,
    requestCode,
    verifyCode,
    signInWithGoogle,
    completePayment,
    busy,
    error,
  } = usePurchaseFlow()
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [code, setCode] = useState("")

  if (!activeFlow) return null

  const plan = getPlan(activeFlow.plan)
  const planLabel = PLAN_LABELS[activeFlow.plan]
  const priceSummary = (
    <LocalPrice
      charged
      inr={plan.cadence ? `${plan.price} ${plan.cadence}` : `${plan.price} — no payment needed`}
      usd={plan.cadence ? `${plan.usd.price} ${plan.cadence}` : `${plan.usd.price} — no payment needed`}
    />
  )

  return (
    <Dialog open onOpenChange={(open) => !open && closeFlow()}>
      <DialogContent className="sm:max-w-md">
        {activeFlow.step === "signup" ? (
          <>
            <DialogHeader>
              <DialogTitle>{activeFlow.authMode === "login" ? "Log in" : "Create your account"}</DialogTitle>
              <DialogDescription>
                Continuing with <span className="font-medium text-foreground">{planLabel}</span> ({priceSummary}).
                We'll email you a 6-digit code — no password needed.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                requestCode(email, name)
              }}
            >
              {activeFlow.authMode === "login" ? null : (
                <div className="space-y-1.5">
                  <label htmlFor="signup-name" className="text-sm font-medium text-foreground">
                    Full name
                  </label>
                  <input
                    id="signup-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Doe"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                </div>
              )}
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
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex flex-col gap-3">
                <LiquidButton type="submit" size="default" className="w-full" disabled={busy}>
                  {busy ? "Sending code…" : "Send code"}
                </LiquidButton>
                <div className="relative py-1 text-center text-xs text-muted-foreground">
                  <span className="relative bg-popover px-2">or</span>
                  <div className="absolute inset-x-0 top-1/2 -z-10 border-t border-border" />
                </div>
                <LiquidButton
                  type="button"
                  variant="outline"
                  size="default"
                  className="w-full"
                  onClick={signInWithGoogle}
                  disabled={busy}
                >
                  <GoogleIcon />
                  Continue with Google
                </LiquidButton>
              </div>
            </form>
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
                {planLabel} is ready. Here&apos;s how to start using it.
              </DialogDescription>
            </DialogHeader>
            <DownloadNextSteps email={accountEmail} onDone={closeFlow} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
