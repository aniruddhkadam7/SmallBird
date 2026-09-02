"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
import { PAID_PLAN_IDS, SUBSCRIPTION_PLAN_IDS, type PlanId } from "@/lib/plans"

export type { PlanId }

export const PLAN_LABELS: Record<PlanId, string> = {
  free: "Free",
  "interview-pass": "Interview Pass",
  "pro-monthly": "Pro Monthly",
  "pro-annual": "Pro Annual",
}

export type FlowStep = "signup" | "verify" | "payment" | "processing" | "done"

interface PurchaseFlowState {
  signedUp: boolean
  email: string | null
  selectedPlan: PlanId | null
  purchased: boolean
  canDownload: boolean
  busy: boolean
  error: string | null
  activeFlow: { plan: PlanId; step: FlowStep } | null
  startFlow: (plan: PlanId) => void
  requestCode: (email: string) => Promise<void>
  verifyCode: (email: string, code: string) => Promise<void>
  completePayment: () => Promise<void>
  closeFlow: () => void
  reset: () => void
}

const PurchaseFlowContext = createContext<PurchaseFlowState | null>(null)

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void }
  }
}

function loadRazorpayScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = "https://checkout.razorpay.com/v1/checkout.js"
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("Could not load the payment form. Check your connection and try again."))
    document.body.appendChild(script)
  })
}

export function PurchaseFlowProvider({ children }: { children: ReactNode }) {
  const [signedUp, setSignedUp] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(null)
  const [purchased, setPurchased] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeFlow, setActiveFlow] = useState<{ plan: PlanId; step: FlowStep } | null>(null)

  // Picks up an already-existing session (e.g. a returning user, or one who
  // verified their code and is continuing) so the flow doesn't ask someone
  // to log in twice.
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) {
        setSignedUp(true)
        setEmail(data.user.email)
      }
    })
  }, [])

  const startFlow = (plan: PlanId) => {
    setError(null)
    setSelectedPlan(plan)
    const step: FlowStep = signedUp ? (PAID_PLAN_IDS.has(plan) ? "payment" : "done") : "signup"
    if (step === "done") setPurchased(true)
    setActiveFlow({ plan, step })
  }

  const requestCode = async (rawEmail: string) => {
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: rawEmail,
        options: { shouldCreateUser: true },
      })
      if (otpError) throw otpError
      setEmail(rawEmail)
      setActiveFlow((prev) => (prev ? { ...prev, step: "verify" } : prev))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const verifyCode = async (rawEmail: string, code: string) => {
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: verifyError } = await supabase.auth.verifyOtp({ email: rawEmail, token: code, type: "email" })
      if (verifyError) throw verifyError
      setSignedUp(true)
      setEmail(rawEmail)
      if (!activeFlow) return
      if (PAID_PLAN_IDS.has(activeFlow.plan)) {
        setActiveFlow({ plan: activeFlow.plan, step: "payment" })
      } else {
        setPurchased(true)
        setActiveFlow({ plan: activeFlow.plan, step: "done" })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const completePayment = async () => {
    if (!activeFlow) return
    const plan = activeFlow.plan
    setBusy(true)
    setError(null)
    try {
      await loadRazorpayScript()

      const endpoint = SUBSCRIPTION_PLAN_IDS.has(plan) ? "/api/razorpay/create-subscription" : "/api/razorpay/create-order"
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: plan }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Could not start checkout")

      const isSubscription = SUBSCRIPTION_PLAN_IDS.has(plan)
      const checkout = new window.Razorpay!({
        key: data.keyId,
        name: "Smallbird",
        description: PLAN_LABELS[plan],
        ...(isSubscription ? { subscription_id: data.subscriptionId } : { order_id: data.orderId, amount: data.amount, currency: data.currency }),
        prefill: email ? { email } : undefined,
        handler: () => {
          // Razorpay confirms payment client-side here, but the actual
          // entitlement update happens via the razorpay-webhook Edge
          // Function, which may land a few seconds later — the download
          // page re-checks server-side rather than trusting this callback
          // as the source of truth.
          setPurchased(true)
          setActiveFlow((prev) => (prev ? { ...prev, step: "done" } : prev))
        },
        modal: {
          ondismiss: () => {
            setBusy(false)
          },
        },
      })
      checkout.open()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const closeFlow = () => setActiveFlow(null)

  const reset = () => {
    setSelectedPlan(null)
    setPurchased(false)
    setActiveFlow(null)
    setError(null)
  }

  const canDownload = signedUp && (selectedPlan === "free" || purchased)

  return (
    <PurchaseFlowContext.Provider
      value={{
        signedUp,
        email,
        selectedPlan,
        purchased,
        canDownload,
        busy,
        error,
        activeFlow,
        startFlow,
        requestCode,
        verifyCode,
        completePayment,
        closeFlow,
        reset,
      }}
    >
      {children}
    </PurchaseFlowContext.Provider>
  )
}

export function usePurchaseFlow() {
  const ctx = useContext(PurchaseFlowContext)
  if (!ctx) {
    throw new Error("usePurchaseFlow must be used within a PurchaseFlowProvider")
  }
  return ctx
}
