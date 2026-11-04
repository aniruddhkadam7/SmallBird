"use client"

import Image from "next/image"
import Link from "next/link"
import logo from "@/assets/smallbird-logo.png"
import { usePurchaseFlow } from "@/lib/purchase-flow"

// Shown to a visitor with no session. It reuses the website's one login
// dialog (email code or Google) rather than having a sign-in of its own, and
// asks that flow to bring them straight back to /mobile afterwards.
export function SignInGate() {
  const { requestPageAccess } = usePurchaseFlow()

  return (
    <main className="page gate">
      <nav className="nav-row">
        <Link href="/" className="back">
          <span aria-hidden>‹</span> Back to smallbirdai.com
        </Link>
      </nav>

      <div className="gate-body">
        <div className="brand-row center">
          <Image src={logo} alt="" className="logo" width={28} height={28} priority />
          <span className="wordmark">SmallBird AI</span>
        </div>
        <h1 className="title center">Use SmallBird AI on your phone</h1>
        <p className="lede center">
          Sign in with your SmallBird AI account, or create a free one. Then put your phone next to your laptop and it listens
          to the interview and suggests answers, with nothing installed on the laptop.
        </p>
        <div className="actions-col">
          <button type="button" className="btn primary big" onClick={() => requestPageAccess("/mobile", "login")}>
            Log in
          </button>
          <button type="button" className="btn" onClick={() => requestPageAccess("/mobile", "signup")}>
            Create a free account
          </button>
        </div>
      </div>
    </main>
  )
}
