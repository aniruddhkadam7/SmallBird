import Link from "next/link"
import { ArrowLeft, Download } from "lucide-react"
import { LiquidButton } from "@/components/ui/liquid-glass-button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"
import { DownloadGateButton } from "./download-gate-button"

// Real platform marks (Microsoft's four-pane flag, Apple's silhouette)
// rather than generic lucide stand-ins (a plain monitor outline read as
// "any computer," not specifically Windows).
function WindowsLogo() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M13 1h10v10H13z" />
      <path fill="#00A4EF" d="M1 13h10v10H1z" />
      <path fill="#FFB900" d="M13 13h10v10H13z" />
    </svg>
  )
}

function AppleLogo() {
  return (
    <svg viewBox="0 0 384 512" width="16" height="16" aria-hidden="true" fill="currentColor">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  )
}

// The stable "always points at the newest release" URL — GitHub resolves
// /releases/latest/download/<asset-name> to whatever the latest tagged
// release's matching asset is, so this link never needs updating per release.
const WINDOWS_INSTALLER_URL = "https://github.com/aniruddhkadam7/SmallBird/releases/latest/download/Smallbird-Setup.exe"

// Server Component: the actual gating decision happens here, from the
// user's real session (via cookies), not from client-only React state that
// would reset on refresh — every signed-in account has at least the free
// plan's entitlement (granted automatically on signup), so "logged in" is
// the real download gate; which plan they're on only affects in-app usage.
export default async function DownloadPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:py-24">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Smallbird
      </Link>

      <div className="mt-10 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Download Smallbird</h1>
        <p className="mt-4 text-muted-foreground">
          {user ? "Pick your platform below." : "Sign in for free, then download and install the desktop app."}
        </p>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border">
              <WindowsLogo />
            </div>
            <CardTitle className="text-lg">Windows</CardTitle>
            <CardDescription>Windows 10 and 11, 64-bit.</CardDescription>
          </CardHeader>
          <CardContent />
          <CardFooter>
            {user ? (
              <LiquidButton className="w-full" asChild>
                <a href={WINDOWS_INSTALLER_URL}>
                  <Download className="h-4 w-4" />
                  Download for Windows
                </a>
              </LiquidButton>
            ) : (
              <DownloadGateButton />
            )}
          </CardFooter>
        </Card>

        <Card className="opacity-70">
          <CardHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border">
              <AppleLogo />
            </div>
            <CardTitle className="text-lg">Mac</CardTitle>
            <CardDescription>Coming soon.</CardDescription>
          </CardHeader>
          <CardContent />
          <CardFooter>
            <LiquidButton className="w-full" variant="outline" disabled>
              <AppleLogo />
              Coming soon
            </LiquidButton>
          </CardFooter>
        </Card>
      </div>

      <p className="mt-10 text-center text-xs text-muted-foreground">
        After installing, sign in with the email you signed up with to start your first session.
      </p>
    </div>
  )
}
