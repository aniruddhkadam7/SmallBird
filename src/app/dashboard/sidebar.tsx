"use client"

import { useRouter } from "next/navigation"
import Image from "next/image"
import { AudioLines, Gift, LogOut, MonitorSmartphone } from "lucide-react"
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
  const name = email.split("@")[0]

  return (
    <div className="dark flex min-h-screen bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col gap-6 border-r border-border bg-background px-4 py-5">
        <a href="/" className="flex items-center gap-2 px-1">
          <Image src={logo} alt="Smallbird" className="h-6 w-auto" />
          <span
            className="text-lg font-bold tracking-tight text-foreground"
            style={{ fontFamily: "var(--font-playfair-display)" }}
          >
            SmallBird
          </span>
        </a>

        <nav className="flex flex-col gap-1">
          <div className="px-2 pb-1 text-xs font-semibold text-muted-foreground">Workspace</div>
          <button
            type="button"
            className="flex items-center gap-2.5 rounded-md bg-foreground/10 px-3 py-2 text-left text-sm font-medium text-foreground"
          >
            <AudioLines className="h-4 w-4" />
            Interviews
          </button>
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-2">
              <Gift className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">
                {plan ? plan.displayName : "Free Plan"}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {plan
                ? `${Math.floor(plan.remainingMinutes)} minutes remaining on your plan.`
                : "Sign in to see your plan."}
            </p>
            {(plan?.isFree ?? true) && (
              <LiquidButton size="sm" className="mt-3 w-full" onClick={() => startFlow("pro-monthly")}>
                Upgrade
              </LiquidButton>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => router.push("/download")}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-foreground/10"
            >
              <MonitorSmartphone className="h-4 w-4" />
              Open Desktop App
            </button>
            <button
              type="button"
              onClick={() => logout()}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-foreground/10"
            >
              <LogOut className="h-4 w-4" />
              Log Out
            </button>
          </div>

          <div className="flex items-center gap-2.5 border-t border-border px-1 pt-3">
            <span
              style={{ backgroundColor: avatarColor }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium text-white"
            >
              {initial}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium capitalize text-foreground">{name}</div>
              <div className="truncate text-xs text-muted-foreground">{email}</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
