import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { InterviewsList } from "./interviews-list"
import { SignInButton } from "./sign-in-button"

// Server Component: reads the signed-in user's own interview_transcripts
// rows via RLS (see migrations/0012_interview_transcripts.sql) -- there is
// no separate API route, since a plain "read my own rows" query needs
// nothing beyond what createClient()'s cookie-scoped session already gives
// it, the same pattern the old download page used for its entitlement
// check.
export default async function InterviewsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: transcripts } = user
    ? await supabase
        .from("interview_transcripts")
        .select("id, started_at_ms, ended_at_ms, role, company, turns")
        .order("started_at_ms", { ascending: false })
    : { data: null }

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
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your Interviews</h1>
        <p className="mt-4 text-muted-foreground">
          {user
            ? "Every interview you've completed in the desktop app while signed in."
            : "Sign in to see interviews you've completed in the desktop app."}
        </p>
      </div>

      {user ? (
        <InterviewsList transcripts={transcripts ?? []} />
      ) : (
        <div className="mt-10 flex justify-center">
          <SignInButton />
        </div>
      )}
    </div>
  )
}
