import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { starterResume, TEMPLATES } from "@/lib/resume/types"

// /resume/new?template=<id> — what tapping a template on the homepage or the
// Resume Builder page opens (after sign-up if needed): makes a new empty
// resume in that template and goes straight to its editor. A route handler,
// not a page, so a link prefetch can never create a resume by itself.
export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.redirect(new URL("/ai-resume-builder", url))

  const template = TEMPLATES.find((t) => t.id === url.searchParams.get("template"))?.id ?? "navy"
  const name = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : ""
  const data = { ...starterResume(name, user.email), template }

  const { data: row, error } = await supabase.from("resumes").insert({ title: "Untitled resume", data }).select("id").single()
  if (error?.message.includes("RESUME_LIMIT")) {
    return NextResponse.redirect(new URL("/dashboard?view=resumes&limit=1", url))
  }
  if (error || !row) return NextResponse.redirect(new URL("/dashboard?view=resumes", url))
  return NextResponse.redirect(new URL(`/resume/${row.id}`, url))
}
