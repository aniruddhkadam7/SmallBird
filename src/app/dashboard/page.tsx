import { createClient } from "@/lib/supabase/server"
import { InterviewsList } from "./interviews-list"

// The layout above already redirects logged-out visitors, so `user` here
// is always present -- this only needs the transcripts query.
export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: transcripts } = await supabase
    .from("interview_transcripts")
    .select("id, started_at_ms, ended_at_ms, role, company, turns")
    .order("started_at_ms", { ascending: false })

  return <InterviewsList transcripts={transcripts ?? []} />
}
