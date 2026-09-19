import { createClient } from "@/lib/supabase/client"

// The same table, row shape and rules the desktop app uses
// (src-tauri/src/history.rs -> interview_transcripts), so a phone interview
// shows up in the dashboard exactly like a desktop one. Row-level security
// scopes every read and write to the signed-in user's own rows, and user_id
// is filled in by the database from the session, never sent from here.

export interface TranscriptTurn {
  question: string
  answer: string
}

export interface TranscriptInput {
  /** Stays the same for the whole interview, so repeated saves update one row. */
  id: string
  startedAtMs: number
  endedAtMs: number
  role: string
  company: string
  turns: TranscriptTurn[]
}

export type SaveStatus = "saved" | "failed" | "empty"

/** A v4 UUID (the table's id column is a uuid). crypto.randomUUID needs a secure context; the fallback covers the rest. */
export function newTranscriptId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`
}

/**
 * Inserts the interview, or updates it if this id was saved before (the
 * desktop saves after every completed answer and once more at the end).
 * Throws on failure. Does nothing for an interview with no answered questions.
 */
export async function saveTranscript(transcript: TranscriptInput): Promise<void> {
  if (transcript.turns.length === 0) return

  const { error } = await createClient()
    .from("interview_transcripts")
    .upsert(
      {
        id: transcript.id,
        started_at_ms: transcript.startedAtMs,
        ended_at_ms: transcript.endedAtMs,
        role: transcript.role.trim() || null,
        company: transcript.company.trim() || null,
        turns: transcript.turns,
      },
      { onConflict: "id" },
    )
  if (error) throw new Error(error.message)
}
