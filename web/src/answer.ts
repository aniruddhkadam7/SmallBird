import { streamChat, type ChatMessage } from "./api";

export interface Profile {
  company: string;
  role: string;
  /** Resume / job description / anything the answers should be grounded in. */
  background: string;
}

export interface QA {
  question: string;
  answer: string;
}

/** Marker the model puts between the glanceable key points and the full spoken answer. */
export const FULL_MARKER = "[[FULL]]";

const HISTORY_TURNS = 4;
const MAX_TOKENS = 650;
const MAX_BACKGROUND_CHARS = 12_000;

// Condensed from the desktop app's Ask AI prompt
// (src-tauri/src/personal/prompts/ask.rs): same voice, honesty and
// never-mention-documents rules, plus a two-part output shape for a phone
// glanced at beside a laptop — key points first so something readable
// appears within a second, the full spoken answer after.
const SYSTEM_PROMPT = `You are the candidate, live in a job interview, answering the interviewer's current question out loud in your own voice.

VOICE
- Use very simple, everyday spoken English. Short sentences. Contractions are fine. Say "uses" not "utilizes", "a lot" not "significantly". Technical terms and real names stay exactly as they are.
- No preamble, no "great question", no restating the question, no closing summary.
- Follow the conversation: a follow-up continues from the previous answer, never re-explains what was already covered.

GROUNDING
- The question comes first. For anything about the candidate's own experience, projects, or skills, use the background below and its real names, tools, companies and numbers. Never contradict it and never invent a made-up example when it gives a real one.
- If the background doesn't cover the question, answer from your own general knowledge like a well-prepared candidate.
- Never mention documents, resumes, context, sources, or what you were given.

OUTPUT FORMAT (strict — this is read at a glance on a phone)
1. First, 2 to 4 bullet lines ("- ") of KEY POINTS, each under 14 words, each starting with the most important word. Bold the key term with **double asterisks**.
2. Then a line containing only ${FULL_MARKER}
3. Then the FULL answer, in the words you'd actually say out loud: short paragraphs, a numbered list only for genuinely sequential steps, **bold** on key terms. Match its length to the question: a simple factual question gets 2-3 sentences; a "why" gets a few; a process or design question gets a fuller walkthrough. For a request to write code, give one short sentence and then a complete fenced code block.`;

function buildMessages(profile: Profile, history: QA[], question: string): ChatMessage[] {
  const background = profile.background.trim().slice(0, MAX_BACKGROUND_CHARS);
  const context = [
    profile.role.trim() && `Role being interviewed for: ${profile.role.trim()}`,
    profile.company.trim() && `Company: ${profile.company.trim()}`,
    background && `Background about the candidate:\n${background}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: ChatMessage[] = [{ role: "system", content: context ? `${SYSTEM_PROMPT}\n\n${context}` : SYSTEM_PROMPT }];
  for (const turn of history.slice(-HISTORY_TURNS)) {
    messages.push({ role: "user", content: turn.question });
    messages.push({ role: "assistant", content: turn.answer });
  }
  messages.push({ role: "user", content: question });
  return messages;
}

/** Streams the answer, calling `onText` with the full text so far on every chunk. */
export async function askAnswer(
  profile: Profile,
  history: QA[],
  question: string,
  sessionId: string,
  onText: (textSoFar: string) => void,
  signal: AbortSignal,
): Promise<string> {
  let text = "";
  await streamChat(
    buildMessages(profile, history, question),
    MAX_TOKENS,
    sessionId,
    (delta) => {
      text += delta;
      onText(text);
    },
    signal,
  );
  return text;
}

export function splitAnswer(raw: string): { points: string; full: string; hasFull: boolean } {
  const at = raw.indexOf(FULL_MARKER);
  if (at < 0) return { points: raw.trim(), full: "", hasFull: false };
  return { points: raw.slice(0, at).trim(), full: raw.slice(at + FULL_MARKER.length).trim(), hasFull: true };
}

/** What gets stored in the conversation history: the spoken answer, without the marker scaffolding. */
export function spokenAnswer(raw: string): string {
  const { points, full, hasFull } = splitAnswer(raw);
  return hasFull ? full : points;
}
