import type { Turn } from "./interview";

export interface QAEntry {
  id: number;
  question: string;
  /** Raw model output, including the [[FULL]] marker (see answer.ts). */
  raw: string;
  done: boolean;
  error?: string;
}

export interface SessionResult {
  entries: QAEntry[];
  turns: Turn[];
  message: string;
  durationSeconds: number;
}
