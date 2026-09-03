import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Where Supabase redirects back to after a Google OAuth login
// (`signInWithOAuth`'s `redirectTo`) — exchanges the auth code for a real
// session (setting the same cookies the email-OTP flow does), then sends
// the user back to wherever `next` says, defaulting to home.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = searchParams.get("next") ?? "/"

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/?auth_error=1`)
}
