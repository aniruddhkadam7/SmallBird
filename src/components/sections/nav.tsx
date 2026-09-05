"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Download } from "lucide-react"
import logo from "@/assets/smallbird-logo.png"
import { cn } from "@/lib/utils"
import { LiquidButton } from "@/components/ui/liquid-glass-button"
import { LiquidGlassContainer } from "@/components/ui/liquid-glass-container"
import { AccountMenu } from "@/components/blocks/account-menu"
import { usePurchaseFlow } from "@/lib/purchase-flow"

// Smallbird is a Windows desktop app — there's nothing to install on a
// phone, so a mobile tap on Download explains that instead of navigating
// to a page whose only action doesn't work on the device the visitor is on.
function isMobileDevice() {
  if (typeof navigator === "undefined") return false
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

const links = [
  { label: "Features", href: "/#features" },
  { label: "Reviews", href: "/#reviews" },
  { label: "Privacy", href: "/#privacy" },
  { label: "Pricing", href: "/pricing" },
]

export function Nav() {
  const router = useRouter()
  const { signedUp, startFlow } = usePurchaseFlow()
  const [showMobileNotice, setShowMobileNotice] = useState(false)

  return (
    <header className="sticky top-4 z-50 flex justify-center px-4">
      <LiquidGlassContainer className="w-full max-w-7xl">
        <div className="flex h-16 w-full items-center justify-between gap-4 px-6">
          <a href="/" className="flex items-center gap-2">
            <Image src={logo} alt="Smallbird" className="h-6 w-auto" priority />
            <span
              className="text-2xl font-bold tracking-tight text-foreground"
              style={{ fontFamily: "var(--font-playfair-display)" }}
            >
              Smallbird<sup className="ml-0.5 text-xs font-normal align-super">™</sup>
            </span>
          </a>
          <nav className="hidden items-center gap-8 sm:flex">
            {links.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className={cn(
                  "border-b-2 border-transparent pb-1 text-sm font-medium text-foreground/80 transition-colors",
                  "hover:border-foreground/30 hover:text-foreground",
                )}
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="relative flex items-center gap-2 sm:gap-3">
            <LiquidButton
              size="sm"
              variant="outline"
              onClick={() => {
                if (isMobileDevice()) {
                  setShowMobileNotice(true)
                  return
                }
                router.push("/download")
              }}
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </LiquidButton>
            {showMobileNotice ? (
              <div
                role="alert"
                className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg"
              >
                Smallbird is a desktop app — open this page on your PC to download it.
                <button
                  type="button"
                  onClick={() => setShowMobileNotice(false)}
                  className="mt-2 block text-xs font-medium text-foreground/70 underline"
                >
                  Got it
                </button>
              </div>
            ) : null}
            {signedUp ? (
              <>
                <LiquidButton
                  size="sm"
                  variant="outline"
                  onClick={() => router.push("/dashboard")}
                  className="hidden sm:inline-flex"
                >
                  Dashboard
                </LiquidButton>
                <AccountMenu />
              </>
            ) : (
              <>
                <LiquidButton
                  size="sm"
                  variant="outline"
                  onClick={() => startFlow("free", "login")}
                  className="hidden sm:inline-flex"
                >
                  Log in
                </LiquidButton>
                <LiquidButton size="sm" onClick={() => startFlow("free", "signup")}>
                  Sign up
                </LiquidButton>
              </>
            )}
          </div>
        </div>
      </LiquidGlassContainer>
    </header>
  )
}
