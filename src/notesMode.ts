// Notes Mode: a meeting written down as who said what. The user's mic is
// "You"; the call audio (everyone else, mixed into one stream) is split by
// Deepgram's speaker diarization into Speaker 1, Speaker 2, … — numbers the
// user can rename to real names. Nothing here asks the AI anything.
//
// Saved through the same save_interview_session as every other mode: each
// paragraph (consecutive lines by one speaker) becomes a turn whose
// `question` is the speaker's name and `answer` is what they said, tagged
// with NOTES_TURN_KIND so Sessions can render it as a transcript.

import type { TranscriptSegment } from "./types";
import type { HistoryTurn } from "./SessionsPanel";

export const NOTES_TURN_KIND = "utterance";

/// One finalized piece of speech. `speaker` is a key (see speakerKeyOf),
/// not a display name, so renaming a speaker relabels every line at once.
export interface NoteLine {
  id: string;
  speaker: string;
  text: string;
  at: number;
}

/// Consecutive lines by the same speaker, shown and saved as one paragraph.
export interface NoteBlock {
  id: string;
  speaker: string;
  text: string;
  at: number;
}

/// "you" = the user's mic; "call:N" = remote speaker N (0-based, as Deepgram
/// numbers them); "call" = call audio that came without a speaker number;
/// "saved:<name>" = a line restored from a saved session.
export function speakerKeyOf(segment: Pick<TranscriptSegment, "source" | "speaker">): string {
  if (segment.source === "MICROPHONE") return "you";
  return segment.speaker == null ? "call" : `call:${segment.speaker}`;
}

export function defaultSpeakerName(key: string): string {
  if (key === "you") return "You";
  if (key === "call") return "Them";
  if (key.startsWith("call:")) return `Speaker ${Number(key.slice("call:".length)) + 1}`;
  if (key.startsWith("saved:")) return key.slice("saved:".length);
  return key;
}

export function speakerName(key: string, names: Record<string, string>): string {
  return names[key]?.trim() || defaultSpeakerName(key);
}

/// A stable colour slot per speaker: "you" has its own, remote speakers
/// cycle through six.
export function speakerColorClass(key: string): string {
  if (key === "you") return "notes-speaker-you";
  const n = key.startsWith("call:") ? Number(key.slice("call:".length)) : hash(key);
  return `notes-speaker-${n % 6}`;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function groupLines(lines: NoteLine[]): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  for (const line of lines) {
    const last = blocks[blocks.length - 1];
    if (last && last.speaker === line.speaker) {
      last.text = `${last.text} ${line.text}`;
    } else {
      blocks.push({ id: line.id, speaker: line.speaker, text: line.text, at: line.at });
    }
  }
  return blocks;
}

export function notesToTurns(lines: NoteLine[], names: Record<string, string>): HistoryTurn[] {
  return groupLines(lines).map((b) => ({
    question: speakerName(b.speaker, names),
    answer: b.text,
    askedAtMs: b.at,
    kind: NOTES_TURN_KIND,
  }));
}

/// Back from a saved session (Sessions → Continue): each saved paragraph
/// keeps the name it was saved under.
export function turnsToNotes(turns: HistoryTurn[], fallbackAt: number): NoteLine[] {
  return turns.map((t, i) => ({
    id: `saved-${i}`,
    speaker: `saved:${t.question}`,
    text: t.answer,
    at: t.askedAtMs ?? fallbackAt,
  }));
}

export function isNotesEntry(turns: HistoryTurn[]): boolean {
  return turns.length > 0 && turns.every((t) => t.kind === NOTES_TURN_KIND);
}

/// Plain text for the clipboard: one "Name: what they said" paragraph each.
export function notesAsText(lines: NoteLine[], names: Record<string, string>): string {
  return groupLines(lines)
    .map((b) => `${speakerName(b.speaker, names)}: ${b.text}`)
    .join("\n\n");
}
