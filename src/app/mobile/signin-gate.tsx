"use client"

import Link from "next/link"
import { usePurchaseFlow } from "@/lib/purchase-flow"

// Shown to a visitor with no session. It reuses the website's one login
// dialog (email code or Google) rather than having a sign-in of its own, and
// asks that flow to bring them straight back to /mobile afterwards.
export function SignInGate() {
  const { requestPageAccess } = usePurchaseFlow()

  return (
    <main className="screen center">
      <Link href="/" className="brand">
        Smallbird
      </Link>
      <h2>Use Smallbird on your phone</h2>
      <p className="muted">
        Sign in with your Smallbird account, or create a free one. Then put your phone next to your laptop and it
        listens to the interview and suggests answers, with nothing installed on the laptop.
      </p>
      <div className="stack">
        <button className="primary" onClick={() => requestPageAccess("/mobile", "login")}>
          Log in
        </button>
        <button onClick={() => requestPageAccess("/mobile", "signup")}>Create a free account</button>
      </div>
      <Link href="/" className="link">
        Back to smallbird.in
      </Link>
    </main>
  )
}
