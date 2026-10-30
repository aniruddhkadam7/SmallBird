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

/**
 * Keeps the original file in the private resume-uploads bucket (Smallbird
 * staff can open it from the admin console; the user can't read it back).
 * Returns its path, or null if the upload failed -- importing goes on anyway.
 */
async function uploadOriginal(file: File): Promise<string | null> {
  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return null
  const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-100) || "resume"
  const path = `${session.user.id}/${crypto.randomUUID()}-${safeName}`
  const { error } = await supabase.storage
    .from("resume-uploads")
    .upload(path, file, { contentType: file.type || undefined, upsert: false })
  return error ? null : path
}

/** Old resume text (from a PDF/DOCX) -> a structured resume. */
export async function aiImport(text: string, file?: File): Promise<ResumeData> {
  const filePath = file ? await uploadOriginal(file).catch(() => null) : null
  return normalizeResume(
    await callResumeAi({ action: "import", text, filePath: filePath ?? undefined, fileName: file?.name }),
  )
}

export interface TailorResult {
  resume: ResumeData
  missingSkills: string[]
  changes: string[]
}

export async function aiTailor(resume: ResumeData, jobDescription: string, instructions = ""): Promise<TailorResult> {
  const out = await callResumeAi({ action: "tailor", resume, jobDescription, instructions: instructions.trim() || undefined })
  return { resume: normalizeResume(out.resume), missingSkills: strings(out.missingSkills), changes: strings(out.changes) }
}

/** Any change the user asks for in their own words ("rewrite my summary"), over the whole resume. */
export async function aiEdit(
  resume: ResumeData,
  instructions: string,
  jobDescription: string,
): Promise<{ resume: ResumeData; changes: string[] }> {
  const out = await callResumeAi({ action: "edit", resume, instructions, jobDescription: jobDescription || undefined })
  return { resume: normalizeResume(out.resume), changes: strings(out.changes) }
}

/** One line or paragraph, rewritten; `context` says where it sits (e.g. "Work experience > Acme"). */
export async function aiRewrite(text: string, instructions: string, context: string, jobDescription: string): Promise<string> {
  const out = await callResumeAi({
    action: "rewrite",
    text,
    instructions: instructions.trim() || undefined,
    context,
    jobDescription: jobDescription || undefined,
  })
  const rewritten = typeof out.text === "string" ? out.text.trim() : ""
  if (!rewritten) throw new Error("The AI didn't return anything. Please try again.")
  return rewritten
}

/** Rewritten items for one entry. Never more items than it had. */
export async function aiImprove(entry: ResumeEntry, jobDescription: string): Promise<string[]> {
  const { id: _id, ...rest } = entry
  void _id
  const out = await callResumeAi({ action: "improve", entry: rest, jobDescription: jobDescription || undefined })
  return strings(out.items).slice(0, Math.max(entry.items.length, 1))
}
