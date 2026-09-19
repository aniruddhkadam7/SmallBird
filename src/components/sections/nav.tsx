"use client"

import { useRouter } from "next/navigation"
import Image from "next/image"
import { Download } from "lucide-react"
import logo from "@/assets/smallbird-logo.png"
import { cn } from "@/lib/utils"
import { LiquidButton } from "@/components/ui/liquid-glass-button"
import { LiquidGlassContainer } from "@/components/ui/liquid-glass-container"
import { AccountMenu } from "@/components/blocks/account-menu"
import { usePurchaseFlow } from "@/lib/purchase-flow"

const links = [
  { label: "Features", href: "/#features" },
  { label: "Reviews", href: "/#reviews" },
  { label: "Privacy", href: "/#privacy" },
  { label: "Pricing", href: "/pricing" },
  { label: "Mobile", href: "/mobile" },
]

export function Nav() {
  const router = useRouter()
  const { signedUp, startFlow } = usePurchaseFlow()

  return (
    <header className="sticky top-4 z-50 flex justify-center px-4">
      <LiquidGlassContainer className="w-full max-w-7xl">
        <div className="flex h-16 w-full items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6">
          <a href="/" className="flex shrink-0 items-center gap-2">
            <Image src={logo} alt="Smallbird" className="h-6 w-auto" priority />
            <span
              className="text-lg font-bold tracking-tight text-foreground sm:text-2xl"
              style={{ fontFamily: "var(--font-playfair-display)" }}
            >
              Smallbird<sup className="ml-0.5 text-xs font-normal align-super">™</sup>
            </span>
          </a>
          <nav className="hidden items-center gap-6 lg:flex xl:gap-8">
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
            <a
              href="/pricing"
              className="text-sm font-medium text-foreground/80 transition-colors hover:text-foreground lg:hidden"
            >
              Pricing
            </a>
            <LiquidButton
              size="sm"
              variant="outline"
              onClick={() => router.push("/download")}
              className="hidden sm:inline-flex"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </LiquidButton>
            {signedUp ? (
              <>
                <LiquidButton size="sm" variant="outline" onClick={() => router.push("/dashboard")}>
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
                  className="hidden lg:inline-flex"
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
