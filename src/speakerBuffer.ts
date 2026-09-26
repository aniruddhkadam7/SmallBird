// Who-said-what for the overlay's question buffer once the user's own
// microphone is on. The call audio ("Them") and the mic ("You") are
// transcribed separately (see commands.rs's start_microphone_inner), so every
// sentence already knows its speaker; this keeps that in the buffer as
// "Them: …" / "You: …" lines, which is what the answer prompt reads (see
// prompts/ask.rs's labeled_conversation_block).

import type { AudioSource } from "./types";
import { joinSpeech } from "./questionCompleteness";

export type SpeakerLabel = "Them" | "You";

const LABELED_LINE = /^(Them|You):/m;

/// Whether the buffer is a speaker-labeled conversation.
export function hasSpeakerLabels(text: string): boolean {
  return LABELED_LINE.test(text);
}

/// The label for a source. `null` (plain dictation, exactly as before the
/// mic existed) unless the mic is on or the buffer is already labeled — so
/// turning the mic off mid-question doesn't glue the other side's words onto
/// the user's last line.
export function speakerLabel(source: AudioSource, micOn: boolean, buffer: string): SpeakerLabel | null {
  if (!micOn && !hasSpeakerLabels(buffer)) return null;
  return source === "MICROPHONE" ? "You" : "Them";
}

/// Adds speech to the buffer. Unlabeled: joined onto the running text.
/// Labeled: continues the last line when the same person is still talking,
/// otherwise starts a new "Label: …" line.
export function appendSpeech(buffer: string, label: SpeakerLabel | null, text: string): string {
  if (!label) return joinSpeech(buffer, text);
  const words = text.trim();
  if (!words) return buffer;
  const trimmed = buffer.trimEnd();
  if (!trimmed) return `${label}: ${words}`;
  const lastLine = trimmed.slice(trimmed.lastIndexOf("\n") + 1);
  if (lastLine.startsWith(`${label}:`)) return `${trimmed} ${words}`;
  return `${trimmed}\n${label}: ${words}`;
}

// ---- Echo: without headphones the mic also hears the speakers, so the other
// side's words come back a second time as "You". Those are dropped by
// comparing against what the call audio said moments ago.

const ECHO_WINDOW_MS = 20_000;

export interface HeardSpeech {
  text: string;
  at: number;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/// Remembers something the call audio said (for echo checks), forgetting
/// anything older than the echo window.
export function rememberHeard(recent: HeardSpeech[], text: string, now = Date.now()): HeardSpeech[] {
  const kept = recent.filter((h) => now - h.at < ECHO_WINDOW_MS);
  kept.push({ text, at: now });
  return kept;
}

function pairs(ws: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < ws.length; i++) out.push(`${ws[i]} ${ws[i + 1]}`);
  return out;
}

/// Whether mic text is just the speakers' audio picked up again. Echo
/// repeats the other side's phrases in the same order, so this compares
/// consecutive word pairs, not loose words — a real answer that reuses the
/// question's words ("What is RAG?" -> "RAG is retrieval plus generation")
/// shares a pair or two at most, while echo shares nearly all of them.
export function isEcho(micText: string, recent: HeardSpeech[], extraHeard: string[] = [], now = Date.now()): boolean {
  const mic = words(micText);
  if (mic.length === 0) return false;
  const heard = [...recent.filter((h) => now - h.at < ECHO_WINDOW_MS).map((h) => h.text), ...extraHeard].map(words);
  if (heard.every((h) => h.length === 0)) return false;
  if (mic.length < 3) {
    // Too short to judge by pairs ("yes", "okay") — only an exact phrase the
    // other side just said counts.
    const phrase = ` ${mic.join(" ")} `;
    return heard.some((h) => ` ${h.join(" ")} `.includes(phrase));
  }
  const heardPairs = new Set(heard.flatMap(pairs));
  const micPairs = pairs(mic);
  const matched = micPairs.filter((p) => heardPairs.has(p)).length;
  return matched / micPairs.length >= 0.6;
}
