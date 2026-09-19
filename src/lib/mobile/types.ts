import type { Turn } from "./interview";
import type { SaveStatus, TranscriptInput } from "./transcripts";

export interface QAEntry {
  id: number;
  question: string;
  /** The model's answer, streamed in as it is generated (see answer.ts). */
  raw: string;
  done: boolean;
  error?: string;
}

export interface SessionResult {
  entries: QAEntry[];
  turns: Turn[];
  message: string;
  durationSeconds: number;
  /** What was (or should be) saved to the dashboard; null when nothing was answered. */
  transcript: TranscriptInput | null;
  saveStatus: SaveStatus;
  /** Set while saveStatus is "saving": settles once the transcript is written (or the write failed). */
  pendingSave?: Promise<"saved" | "failed">;
}
