import type { Metadata, Viewport } from "next"
import { createClient } from "@/lib/supabase/server"
import { MobileApp } from "./mobile-app"
import { SignInGate } from "./signin-gate"
import "./mobile.css"

export const metadata: Metadata = {
  title: "SmallBird AI on your phone",
  description: "Use your phone as the listener: put it next to your laptop and get live AI answers during your interview.",
  robots: { index: false, follow: false },
}

// Lets the page draw under the notch and colours the browser chrome to match
// the light setup screens (the live interview screen itself is dark).
export const viewport: Viewport = {
  themeColor: "#f4f5f7",
  viewportFit: "cover",
}

// One login for the whole site: the same session cookie the dashboard reads.
// Signed-in visitors get the interview flow; everyone else gets the site's
// normal sign-in, then lands back here.
export default async function MobilePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return <div className="sbm">{user?.email ? <MobileApp email={user.email} /> : <SignInGate />}</div>
}
