import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Entry point for the desktop app's "Open Dashboard" button — the user is
// already signed in on the desktop app, so it mints a one-time magic-link
// token server-side (see SmallBird-Local-exe's dashboard-handoff Supabase
// function) and hands it here to sign the browser in too, instead of
// showing this site's own login screen for a session the user already has
// elsewhere. Same shape as /auth/callback (the Google OAuth landing route)
// but redeems a magic-link token_hash via verifyOtp instead of exchanging
// an OAuth code.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get("token_hash")
  const next = searchParams.get("next") ?? "/dashboard"

  if (tokenHash) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" })
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Invalid/expired/missing token — fall through to the dashboard itself,
  // which shows its own sign-in prompt for a user who isn't authenticated.
  return NextResponse.redirect(`${origin}/dashboard`)
}
