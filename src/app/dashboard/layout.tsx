import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { DashboardSidebar } from "./sidebar"
import { InterviewsList } from "./interviews-list"
import { ResumesList, type ResumeListItem } from "./resumes-list"

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
}

// Logged-out visitors get bounced to the homepage rather than a bare
// "please sign in" page here -- there's nowhere sensible to render a
// sidebar shell around for someone with no account yet, and the homepage
// nav already has the sign-in flow front and center.
//
// Renders the page content directly here instead of `children` (page.tsx
// exists only so /dashboard is a real route) -- entitlement and
// transcripts both need the same `user`, so fetching them together with
// Promise.all after the one unavoidable getUser() call cuts this from
// three sequential round-trips (verify session, then read plan, then
// read transcripts -- the last two waterfalled behind a layout/page
// parent-child boundary that can't start the child's fetch until the
// parent resolves) down to two: verify session, then plan+transcripts
// concurrently. That waterfall was the actual cause of "tapping
// Dashboard feels slow" -- there was also no loading state, so the
// unavoidable network round-trip just looked like nothing happened.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  void children

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    redirect("/")
  }

  const [{ data: entitlement }, { data: transcripts }, { data: resumes }] = await Promise.all([
    supabase
      .from("entitlements")
      .select("plan_id, remaining_minutes, plans(display_name, billing_type)")
      .eq("user_id", user.id)
      .returns<
        { plan_id: string; remaining_minutes: number; plans: { display_name: string; billing_type: string } | null }[]
      >()
      .single(),
    supabase
      .from("interview_transcripts")
      .select("id, started_at_ms, ended_at_ms, role, company, turns")
      .order("started_at_ms", { ascending: false }),
    supabase
      .from("resumes")
      .select("id, title, data, updated_at")
      .order("updated_at", { ascending: false })
      .returns<ResumeListItem[]>(),
  ])

  const plan = entitlement
    ? {
        displayName: entitlement.plans?.display_name ?? "Free Plan",
        remainingMinutes: Number(entitlement.remaining_minutes),
        isFree: entitlement.plans?.billing_type === "free" || !entitlement.plans,
      }
    : null

  // Set by the OTP/signup flows (options.data.full_name) when the account
  // was created, or backfilled the next time an existing account without
  // one logs in through them — see request-otp's verify-otp Edge Function
  // and the website's own signInWithOtp call. Absent for older accounts
  // that haven't been through either since this was added; the sidebar
  // falls back to a cleaned-up version of the email in that case.
  const fullName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : null

  return (
    <DashboardSidebar
      email={user.email}
      name={fullName || null}
      plan={plan}
      resumesView={
        <ResumesList
          resumes={resumes ?? []}
          name={fullName ?? ""}
          email={user.email}
          planId={entitlement?.plan_id ?? "free"}
          planName={plan?.displayName ?? "Free"}
        />
      }
    >
      <InterviewsList transcripts={transcripts ?? []} />
    </DashboardSidebar>
  )
}
