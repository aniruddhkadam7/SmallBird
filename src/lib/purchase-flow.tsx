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
  signInWithGoogle: () => Promise<void>
  completePayment: () => Promise<void>
  closeFlow: () => void
  reset: () => void
  logout: () => Promise<void>
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

  // Picks up an already-existing session (e.g. a returning user, one who
  // verified their code, or one who just came back from Google OAuth) so
  // the flow doesn't ask someone to log in twice. If a plan was mid-checkout
  // before an OAuth redirect (see signInWithGoogle), resume it here rather
  // than losing that context across the full-page navigation.
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user?.email) return
      setSignedUp(true)
      setEmail(data.user.email)

      const pendingPlan = sessionStorage.getItem("smallbird:pending-plan") as PlanId | null
      if (pendingPlan) {
        sessionStorage.removeItem("smallbird:pending-plan")
        setSelectedPlan(pendingPlan)
        if (PAID_PLAN_IDS.has(pendingPlan)) {
          setActiveFlow({ plan: pendingPlan, step: "payment" })
        } else {
          setPurchased(true)
        }
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

  const PENDING_PLAN_KEY = "smallbird:pending-plan"

  const signInWithGoogle = async () => {
    setBusy(true)
    setError(null)
    try {
      // OAuth is a full-page redirect, so anything about which plan the
      // user was mid-checkout for would otherwise be lost — stashed here
      // and picked back up by the mount effect once they land back on
      // this page as a signed-in user.
      if (activeFlow) sessionStorage.setItem(PENDING_PLAN_KEY, activeFlow.plan)
      const supabase = createClient()
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          // Without this, Google silently reuses whichever account is
          // already signed into the device's browser instead of showing
          // the account picker - most noticeable on mobile, where a
          // browser usually only has one Google session active anyway.
          queryParams: { prompt: "select_account" },
        },
      })
      if (oauthError) throw oauthError
      // On success the browser navigates away immediately; busy/error state
      // here is only ever seen if signInWithOAuth itself failed to start.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const logout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    setSignedUp(false)
    setEmail(null)
    setPurchased(false)
    setSelectedPlan(null)
    // A hard navigation, not router.push -- pages like /dashboard gate
    // themselves with a *server-side* session check (cookies read in a
    // Server Component), which a client-side signOut() doesn't retrigger
    // on its own. Without this, clicking Log Out visibly did nothing:
    // the session was gone, but the already-rendered dashboard just sat
    // there until the next real page load.
    window.location.href = "/"
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
        image: `${window.location.origin}/smallbird-logo.png`,
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
        signInWithGoogle,
        completePayment,
        closeFlow,
        reset,
        logout,
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
