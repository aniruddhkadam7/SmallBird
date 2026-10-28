"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { usePurchaseFlow } from "@/lib/purchase-flow"

// Deterministic hue per user so every account gets a distinct, stable
// avatar color instead of everyone sharing the same black circle.
function colorForUser(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i)
    hash |= 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 65%, 45%)`
}

// Adobe/most-SaaS-header pattern: an initial-letter avatar in the top-right
// once signed in, opening a small menu with the account email and sign out
// — replaces the "Get Started" CTA for a returning user, since asking them
// to sign up again would be redundant.
export function AccountMenu() {
  const { signedUp, email, logout } = usePurchaseFlow()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [open])

  if (!signedUp || !email) return null

  const initial = email.charAt(0).toUpperCase()
  const avatarColor = colorForUser(email)

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
        style={{ backgroundColor: avatarColor }}
        className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium text-white transition-opacity hover:opacity-80"
      >
        {initial}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] w-56 rounded-lg border border-border bg-popover p-1 shadow-lg">
          <div className="px-3 py-2 text-sm text-muted-foreground">{email}</div>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              router.push("/dashboard")
            }}
            className="w-full rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-foreground/5"
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              router.push("/dashboard?view=resumes")
            }}
            className="w-full rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-foreground/5"
          >
            Resume builder
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              router.push("/download")
            }}
            className="w-full rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-foreground/5"
          >
            Download
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              router.push("/mobile")
            }}
            className="w-full rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-foreground/5"
          >
            Mobile version
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              logout()
            }}
            className="w-full rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-foreground/5"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  )
}
