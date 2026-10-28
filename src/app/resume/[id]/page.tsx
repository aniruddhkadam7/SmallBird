import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { resumeFonts } from "@/lib/resume/fonts"
import { normalizeResume } from "@/lib/resume/types"
import { ResumeEditor } from "./editor"
import "../resume.css"

export const metadata: Metadata = {
  title: "Resume builder",
  robots: { index: false, follow: false },
}

export default async function ResumePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) redirect("/")

  // RLS: someone else's resume id simply finds nothing.
  const { data: row } = await supabase.from("resumes").select("id, title, data").eq("id", id).maybeSingle()
  if (!row) notFound()

  return (
    <div className={resumeFonts}>
      <ResumeEditor id={row.id as string} initialTitle={row.title as string} initialData={normalizeResume(row.data)} />
    </div>
  )
}
