"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import { PAID_PLAN_IDS, type PlanId } from "@/lib/plans"
import { trackEvent } from "@/lib/analytics"

export type { PlanId }

export const PLAN_LABELS: Record<PlanId, string> = {
  free: "Free",
  starter: "Starter Pass",
  pro: "Pro Pass",
  "pro-plus": "Pro+ Pass",
}

export type FlowStep = "signup" | "verify" | "payment" | "processing" | "done"
export type AuthMode = "login" | "signup"

interface PurchaseFlowState {
  signedUp: boolean
  email: string | null
  selectedPlan: PlanId | null
  purchased: boolean
  canDownload: boolean
  busy: boolean
  error: string | null
  activeFlow: { plan: PlanId; step: FlowStep; authMode: AuthMode } | null
  startFlow: (plan: PlanId, authMode?: AuthMode) => void
  requestDashboardAccess: () => void
  requestPageAccess: (path: string, authMode?: AuthMode) => void
  requestCode: (email: string, name: string) => Promise<void>
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

// A brand-new account is sent straight to the download page once, right
// after signing up -- without it people registered and then didn't know
// what to do next. "New" = created in the last 30 minutes, so an old account
// logging in on a fresh browser isn't sent there.
const WELCOME_SHOWN_KEY = "smallbird:welcome-shown"
const NEW_ACCOUNT_MS = 30 * 60 * 1000

function shouldWelcome(user: User): boolean {
  if (Date.now() - Date.parse(user.created_at) > NEW_ACCOUNT_MS) return false
  try {
    return localStorage.getItem(WELCOME_SHOWN_KEY) !== user.id
  } catch {
    return true
  }
}

function markWelcomed(user: User) {
  try {
    localStorage.setItem(WELCOME_SHOWN_KEY, user.id)
  } catch {
    // Storage blocked -- they may just be sent there again next time.
  }
}

function goToDownload(user: User) {
  markWelcomed(user)
  window.location.href = "/download?welcome=1"
}

/// Someone who signed up to build a resume (a template tap, "Build my resume")
/// came for the website's resume builder, not the desktop app, so they skip
/// the download page and go straight to what they asked for.
function cameForResume(pendingRedirect: string | null): boolean {
  return !!pendingRedirect && (pendingRedirect.startsWith("/resume") || pendingRedirect.includes("view=resumes"))
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
  const [activeFlow, setActiveFlow] = useState<{ plan: PlanId; step: FlowStep; authMode: AuthMode } | null>(null)
  // Held between requestCode and verifyCode — signInWithOtp's `data` only
  // seeds user_metadata for a brand-new account, so a returning user who
  // doesn't have a name stored yet needs it applied via updateUser once
  // they're actually signed in (see verifyCode below).
  const [pendingName, setPendingName] = useState("")

  const PENDING_REDIRECT_KEY = "smallbird:post-auth-redirect"

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
      sessionStorage.removeItem("smallbird:pending-plan")
      if (pendingPlan && PAID_PLAN_IDS.has(pendingPlan)) {
        // Paying first; the "done" step offers the download afterwards.
        setSelectedPlan(pendingPlan)
        setActiveFlow({ plan: pendingPlan, step: "payment", authMode: "signup" })
        markWelcomed(data.user)
        return
      }

      const pendingRedirect = sessionStorage.getItem(PENDING_REDIRECT_KEY)

      // Just signed up (e.g. back from Google): the download page comes
      // before wherever they were headed — unless they came for a resume.
      if (shouldWelcome(data.user)) {
        if (cameForResume(pendingRedirect)) {
          markWelcomed(data.user)
        } else {
          sessionStorage.removeItem(PENDING_REDIRECT_KEY)
          goToDownload(data.user)
          return
        }
      }

      if (pendingRedirect) {
        sessionStorage.removeItem(PENDING_REDIRECT_KEY)
        window.location.href = pendingRedirect
        return
      }

      if (pendingPlan) {
        setSelectedPlan(pendingPlan)
        setPurchased(true)
      }
    })
  }, [])

  const startFlow = (plan: PlanId, authMode: AuthMode = "signup") => {
    trackEvent(`buy_start_${plan}`)
    setError(null)
    setSelectedPlan(plan)
    const step: FlowStep = signedUp ? (PAID_PLAN_IDS.has(plan) ? "payment" : "done") : "signup"
    if (step === "done") setPurchased(true)
    setActiveFlow({ plan, step, authMode })
  }

  // Used by CTAs that link straight to a gated page (e.g. the hero's
  // "Dashboard" button) -- signed-in visitors go straight there, signed-out
  // ones get the sign-in dialog instead of bouncing off the page's own
  // server-side auth redirect with no explanation.
  const requestDashboardAccess = () => requestPageAccess("/dashboard")

  // Same idea for any signed-in-only page (e.g. /mobile): one login for the
  // whole site, and the user lands back on the page they actually asked for.
  const requestPageAccess = (path: string, authMode?: AuthMode) => {
    if (signedUp) {
      window.location.href = path
      return
    }
    sessionStorage.setItem(PENDING_REDIRECT_KEY, path)
    startFlow("free", authMode)
  }

  const requestCode = async (rawEmail: string, name: string) => {
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const trimmedName = name.trim()
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: rawEmail,
        options: { shouldCreateUser: true, data: trimmedName ? { full_name: trimmedName } : undefined },
      })
      if (otpError) throw otpError
      setEmail(rawEmail)
      setPendingName(trimmedName)
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
      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        email: rawEmail,
        token: code,
        type: "email",
      })
      if (verifyError) throw verifyError
      setSignedUp(true)
      setEmail(rawEmail)

      // Backfill for an existing account that signed up before name
      // collection existed, or simply didn't have one set yet.
      if (pendingName && !verifyData.user?.user_metadata?.full_name) {
        await supabase.auth.updateUser({ data: { full_name: pendingName } })
      }

      const user = verifyData.user
      const paying = !!activeFlow && PAID_PLAN_IDS.has(activeFlow.plan)
      const pendingRedirect = sessionStorage.getItem(PENDING_REDIRECT_KEY)
      if (user && !paying && shouldWelcome(user)) {
        if (cameForResume(pendingRedirect)) {
          markWelcomed(user)
        } else {
          sessionStorage.removeItem(PENDING_REDIRECT_KEY)
          goToDownload(user)
          return
        }
      }

      if (pendingRedirect) {
        sessionStorage.removeItem(PENDING_REDIRECT_KEY)
        window.location.href = pendingRedirect
        return
      }

      if (!activeFlow) return
      if (paying) {
        if (user) markWelcomed(user)
        setActiveFlow({ plan: activeFlow.plan, step: "payment", authMode: activeFlow.authMode })
      } else {
        setPurchased(true)
        setActiveFlow({ plan: activeFlow.plan, step: "done", authMode: activeFlow.authMode })
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

      const response = await fetch("/api/razorpay/create-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: plan }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Could not start checkout")

      const checkout = new window.Razorpay!({
        key: data.keyId,
        name: "Smallbird",
        image: `${window.location.origin}/smallbird-logo.png`,
        description: PLAN_LABELS[plan],
        order_id: data.orderId,
        amount: data.amount,
        currency: data.currency,
        prefill: email ? { email } : undefined,
        handler: () => {
          // Razorpay confirms payment client-side here, but the actual
          // entitlement update happens via the razorpay-webhook Edge
          // Function, which may land a few seconds later — the download
          // page re-checks server-side rather than trusting this callback
          // as the source of truth.
          trackEvent("payment_success")
          setPurchased(true)
          setActiveFlow((prev) => (prev ? { ...prev, step: "done" } : prev))
        },
        modal: {
          ondismiss: () => {
            trackEvent("checkout_closed")
            setBusy(false)
          },
        },
      })
      trackEvent("checkout_open")
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
        requestDashboardAccess,
        requestPageAccess,
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
