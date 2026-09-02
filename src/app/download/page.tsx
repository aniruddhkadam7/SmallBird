import Link from "next/link"
import { ArrowLeft, Monitor, Apple, Download } from "lucide-react"
import { LiquidButton } from "@/components/ui/liquid-glass-button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"
import { DownloadGateButton } from "./download-gate-button"

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
              <Monitor className="h-5 w-5 text-foreground" />
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
              <Apple className="h-5 w-5 text-foreground" />
            </div>
            <CardTitle className="text-lg">Mac</CardTitle>
            <CardDescription>Coming soon.</CardDescription>
          </CardHeader>
          <CardContent />
          <CardFooter>
            <LiquidButton className="w-full" variant="outline" disabled>
              <Apple className="h-4 w-4" />
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
