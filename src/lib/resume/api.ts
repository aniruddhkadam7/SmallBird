import { createClient } from "@/lib/supabase/client"
import { normalizeResume, type ResumeData, type ResumeEntry, type ResumeRow } from "./types"

// Saved resumes live in public.resumes; row-level security scopes every read
// and write to the signed-in user, and user_id is filled in by the database.

const FUNCTIONS_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL!}/functions/v1`
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export async function createResume(title: string, data: ResumeData): Promise<string> {
  const { data: row, error } = await createClient().from("resumes").insert({ title, data }).select("id").single()
  // The database refuses resumes past the plan's limit (migration 0050's trigger).
  if (error?.message.includes("RESUME_LIMIT")) {
    const max = /allows (\d+)/.exec(error.message)?.[1]
    throw new Error(
      `Your plan lets you keep ${max ?? "a limited number of"} resumes. Delete one, or upgrade to Pro for unlimited resumes.`,
    )
  }
  if (error || !row) throw new Error("Couldn't create the resume. Please try again.")
  return row.id as string
}

export async function saveResume(id: string, title: string, data: ResumeData): Promise<void> {
  const { error } = await createClient().from("resumes").update({ title, data }).eq("id", id)
  if (error) throw new Error(error.message)
}

export async function deleteResume(id: string): Promise<void> {
  const { error } = await createClient().from("resumes").delete().eq("id", id)
  if (error) throw new Error("Couldn't delete the resume. Please try again.")
}

export async function duplicateResume(row: Pick<ResumeRow, "title" | "data">): Promise<string> {
  return createResume(`${row.title} (copy)`, normalizeResume(row.data))
}

// ---- AI (the resume-ai Edge Function) --------------------------------------

async function callResumeAi(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const {
    data: { session },
  } = await createClient().auth.getSession()
  if (!session) throw new Error("Please sign in again.")

  let res: Response
  try {
    res = await fetch(`${FUNCTIONS_URL}/resume-ai`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error("Couldn't reach Smallbird. Check your connection and try again.")
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok || !json) throw new Error(typeof json?.error === "string" ? json.error : `Request failed (${res.status})`)
  return json
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && !!s.trim()) : [])

/** Old resume text (from a PDF/DOCX) -> a structured resume. */
export async function aiImport(text: string): Promise<ResumeData> {
  return normalizeResume(await callResumeAi({ action: "import", text }))
}

export interface TailorResult {
  resume: ResumeData
  missingSkills: string[]
  changes: string[]
}

export async function aiTailor(resume: ResumeData, jobDescription: string): Promise<TailorResult> {
  const out = await callResumeAi({ action: "tailor", resume, jobDescription })
  return { resume: normalizeResume(out.resume), missingSkills: strings(out.missingSkills), changes: strings(out.changes) }
}

/** Rewritten items for one entry. Never more items than it had. */
export async function aiImprove(entry: ResumeEntry, jobDescription: string): Promise<string[]> {
  const { id: _id, ...rest } = entry
  void _id
  const out = await callResumeAi({ action: "improve", entry: rest, jobDescription: jobDescription || undefined })
  return strings(out.items).slice(0, Math.max(entry.items.length, 1))
}
