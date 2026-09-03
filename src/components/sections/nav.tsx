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
  { label: "Product", href: "/#product-demo" },
  { label: "Interview Mode", href: "/#modes" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Privacy", href: "/#privacy" },
]

export function Nav() {
  const router = useRouter()
  const { signedUp, startFlow } = usePurchaseFlow()

  return (
    <header className="sticky top-4 z-50 flex justify-center px-4">
      <LiquidGlassContainer className="w-full max-w-5xl">
        <div className="flex h-16 w-full items-center justify-between gap-4 px-4">
          <a href="/" className="flex items-center gap-2">
            <Image src={logo} alt="Smallbird" className="h-6 w-auto" priority />
            <span
              className="text-2xl font-bold tracking-tight text-foreground"
              style={{ fontFamily: "var(--font-playfair-display)" }}
            >
              SmallBird
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
          <div className="flex items-center gap-3">
            <LiquidButton size="sm" variant="outline" onClick={() => router.push("/download")}>
              <Download className="h-3.5 w-3.5" />
              Download
            </LiquidButton>
            {signedUp ? (
              <AccountMenu />
            ) : (
              <>
                <LiquidButton size="sm" variant="outline" onClick={() => startFlow("free")}>
                  Log in
                </LiquidButton>
                <LiquidButton size="sm" onClick={() => startFlow("free")}>
                  Register
                </LiquidButton>
              </>
            )}
          </div>
        </div>
      </LiquidGlassContainer>
    </header>
  )
}
