"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { usePurchaseFlow } from "@/lib/purchase-flow"

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

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-sm font-medium text-background transition-opacity hover:opacity-80"
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
