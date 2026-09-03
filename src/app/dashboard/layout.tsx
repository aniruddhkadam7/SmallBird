import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { DashboardSidebar } from "./sidebar"

// Logged-out visitors get bounced to the homepage rather than a bare
// "please sign in" page here -- there's nowhere sensible to render a
// sidebar shell around for someone with no account yet, and the homepage
// nav already has the sign-in flow front and center.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    redirect("/")
  }

  const { data: entitlement } = await supabase
    .from("entitlements")
    .select("remaining_minutes, plans(display_name, billing_type)")
    .eq("user_id", user.id)
    .returns<{ remaining_minutes: number; plans: { display_name: string; billing_type: string } | null }[]>()
    .single()

  const plan = entitlement
    ? {
        displayName: entitlement.plans?.display_name ?? "Free Plan",
        remainingMinutes: Number(entitlement.remaining_minutes),
        isFree: entitlement.plans?.billing_type === "free" || !entitlement.plans,
      }
    : null

  return (
    <DashboardSidebar email={user.email} plan={plan}>
      {children}
    </DashboardSidebar>
  )
}
