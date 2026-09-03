"use client"

import { useRouter } from "next/navigation"
import Image from "next/image"
import { Download, LogOut, MonitorSmartphone } from "lucide-react"
import logo from "@/assets/smallbird-logo.png"
import { LiquidButton } from "@/components/ui/liquid-glass-button"
import { usePurchaseFlow } from "@/lib/purchase-flow"

function colorForUser(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i)
    hash |= 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 65%, 45%)`
}

interface PlanInfo {
  displayName: string
  remainingMinutes: number
  isFree: boolean
}

export function DashboardSidebar({
  email,
  plan,
  children,
}: {
  email: string
  plan: PlanInfo | null
  children: React.ReactNode
}) {
  const router = useRouter()
  const { logout, startFlow } = usePurchaseFlow()
  const initial = email.charAt(0).toUpperCase()
  const avatarColor = colorForUser(email)

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card px-4 py-5">
        <a href="/" className="flex items-center gap-2 px-2">
          <Image src={logo} alt="Smallbird" className="h-6 w-auto" />
          <span
            className="text-lg font-bold tracking-tight text-foreground"
            style={{ fontFamily: "var(--font-playfair-display)" }}
          >
            SmallBird
          </span>
        </a>

        <div className="mt-8 flex flex-col gap-1">
          <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Workspace
          </div>
          <button
            type="button"
            className="flex items-center gap-2 rounded-md bg-foreground/5 px-3 py-2 text-left text-sm font-medium text-foreground"
          >
            Interviews
          </button>
        </div>

        <div className="mt-auto flex flex-col gap-3">
          <div className="rounded-lg border border-border p-3">
            <div className="text-sm font-semibold text-foreground">
              {plan ? plan.displayName : "Free Plan"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {plan ? `${Math.floor(plan.remainingMinutes)} min remaining` : "—"}
            </div>
            {(plan?.isFree ?? true) && (
              <LiquidButton size="sm" className="mt-3 w-full" onClick={() => startFlow("pro-monthly")}>
                Upgrade
              </LiquidButton>
            )}
          </div>

          <button
            type="button"
            onClick={() => router.push("/download")}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-foreground/5"
          >
            <MonitorSmartphone className="h-4 w-4" />
            Open Desktop App
          </button>
          <button
            type="button"
            onClick={() => logout()}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-foreground/5"
          >
            <LogOut className="h-4 w-4" />
            Log Out
          </button>

          <div className="flex items-center gap-2 border-t border-border px-2 pt-3">
            <span
              style={{ backgroundColor: avatarColor }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white"
            >
              {initial}
            </span>
            <span className="truncate text-xs text-muted-foreground">{email}</span>
          </div>
        </div>
      </aside>

      <div className="flex-1 px-8 py-10">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Interviews</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every interview you've completed in the desktop app while signed in.
            </p>
          </div>
          <LiquidButton size="sm" variant="outline" onClick={() => router.push("/download")}>
            <Download className="h-3.5 w-3.5" />
            Download
          </LiquidButton>
        </div>

        <div className="mx-auto max-w-3xl">{children}</div>
      </div>
    </div>
  )
}
