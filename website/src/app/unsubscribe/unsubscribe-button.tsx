"use client"

import { useState } from "react"
import { LiquidButton } from "@/components/ui/liquid-glass-button"

type State = "idle" | "working" | "done" | "error"

export function UnsubscribeButton({ userId, token }: { userId: string; token: string }) {
  const [state, setState] = useState<State>("idle")
  const [message, setMessage] = useState("")

  async function unsubscribe() {
    setState("working")
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/unsubscribe`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
        body: JSON.stringify({ u: userId, t: token }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.")
      setState("done")
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong. Please try again.")
      setState("error")
    }
  }

  if (state === "done") {
    return (
      <p className="max-w-sm text-sm text-muted-foreground">
        You&apos;re unsubscribed. We won&apos;t send you offers or announcements any more. You&apos;ll still get emails about
        your account and payments.
      </p>
    )
  }

  return (
    <>
      <p className="max-w-sm text-sm text-muted-foreground">
        Press the button to stop receiving offers and announcements from SmallBird AI.
      </p>
      <LiquidButton onClick={unsubscribe} disabled={state === "working"}>
        {state === "working" ? "Unsubscribing…" : "Unsubscribe"}
      </LiquidButton>
      {state === "error" ? <p className="text-sm text-destructive">{message}</p> : null}
    </>
  )
}
