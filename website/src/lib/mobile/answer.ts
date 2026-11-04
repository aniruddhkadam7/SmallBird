import { streamChat, type ChatMessage } from "./api";

export interface Profile {
  company: string;
  role: string;
  /** Text of the uploaded CV / resume, and the file it came from (shown in the UI). */
  resume: string;
  resumeName: string;
  /** Text of the uploaded job description, and the file it came from. */
  jobDescription: string;
  jobDescriptionName: string;
}

export const EMPTY_PROFILE: Profile = { company: "", role: "", resume: "", resumeName: "", jobDescription: "", jobDescriptionName: "" };

export interface QA {
  question: string;
  answer: string;
}

const HISTORY_TURNS = 4;

// How much to say depends on what was asked (the desktop app does the same).
// One fixed size for everything is why "explain X in detail" came back short.
export type AnswerDepth = "short" | "medium" | "detailed" | "code";

const SHORT_CUES = /\b(briefly|in brief|in short|in a nutshell|quickly|one line|one sentence|in a sentence|yes or no|tl;?dr|short answer|just the (name|basics|gist))\b/;
const CODE_CUES = /\b(write|implement|code|coding|leetcode|sql query|regex|snippet)\b/;
const DETAILED_CUES =
  /\b(in detail|detailed|in depth|in-depth|deep dive|step by step|step-by-step|end to end|end-to-end|comprehensive|thorough|thoroughly|walk me through|walk us through|explain how|how does|how do|how would you (design|build|implement|scale|architect)|architecture|architect|system design|design an?|internals|under the hood|from scratch|life ?cycle|pipeline|everything about|all about|elaborate|deep)\b/;
// Comparisons need both sides explained, even when they start like a definition ("What's the difference between...").
const COMPARISON = /\b(difference|differences|differ|compare|comparison|versus|vs\.?|pros and cons|trade-?offs?|better than|advantages|disadvantages)\b/;
const DEFINITION = /^(what is|what's|what are|what does|define|who|when|which|is it|are there|do you|have you|did you)\b/;

export function answerDepth(question: string): AnswerDepth {
  const q = question.toLowerCase().trim();
  if (SHORT_CUES.test(q)) return "short";
  if (CODE_CUES.test(q)) return "code";
  if (DETAILED_CUES.test(q)) return "detailed";
  if (COMPARISON.test(q)) return "medium";
  if (DEFINITION.test(q) && q.split(/\s+/).length <= 12) return "short";
  return "medium";
}

const TOKEN_BUDGET: Record<AnswerDepth, number> = { short: 300, medium: 650, detailed: 1500, code: 1000 };

const LENGTH_INSTRUCTION: Record<AnswerDepth, string> = {
  short: "SHORT. A direct answer in one sentence, then one or two sentences of real supporting detail. No bullets.",
  medium:
    "MEDIUM. A direct answer, then the core reasoning or mechanism, about 120 to 180 words. Use 3 to 5 bullets or a short numbered list when there are separate points.",
  detailed:
    "DETAILED. The interviewer wants depth, so give a complete, well-organised explanation of about 300 to 450 words and do not stop early. Open with a one-sentence direct answer. Then cover, in order: how it works step by step (a numbered list, each step a full sentence with the key term in bold), a concrete example, and the main trade-offs, limits or common mistakes. Real specifics beat generalities.",
  code: "CODE. At most one short framing sentence, then complete, correct, runnable code in a fenced block, then at most one sentence on complexity or a key trade-off.",
};
// Per document, so a long job description can't crowd the CV out (or the reverse).
const MAX_RESUME_CHARS = 9_000;
const MAX_JOB_DESCRIPTION_CHARS = 5_000;

// Condensed from the desktop app's Ask AI prompt
// (src-tauri/src/personal/prompts/ask.rs): same voice, honesty and
// never-mention-documents rules, with an output shape that reads at a glance
// on a phone next to a laptop: a direct sentence first, bullets only when the
// question needs them.
const SYSTEM_PROMPT = `You are the candidate, live in a job interview, answering the interviewer's current question out loud in your own voice.

VOICE
- Use very simple, everyday spoken English. Short sentences. Contractions are fine. Say "uses" not "utilizes", "a lot" not "significantly". Technical terms and real names stay exactly as they are.
- No preamble, no "great question", no restating the question, no closing summary.
- Follow the conversation: a follow-up continues from the previous answer, never re-explains what was already covered.

GROUNDING
- The question comes first. For anything about the candidate's own experience, projects, or skills, use the "About the candidate" part of the supporting background and its real names, tools, companies and numbers. Never contradict it and never invent a made-up example when it gives a real one.
- Use the role, company and "Job context" to pitch the answer at the right level, and to connect what the candidate has really done to what this job asks for.
- If the background doesn't cover the question, answer from your own general knowledge like a well-prepared candidate.
- Never mention documents, resumes, context, sources, or what you were given.

OUTPUT FORMAT (read at a glance on a phone, so keep it easy to scan)
- Give ONE answer. No headings and no labels.
- Start with the direct answer in one short sentence, in the words you'd actually say out loud.
- When the answer needs more than a couple of sentences, add bullet lines ("- ") or a numbered list, each item a full spoken sentence with the key term in **bold**. Use a numbered list for sequential steps.
- Follow the "ANSWER LENGTH" given with the question. It sets how much to say: never pad a short answer, and never cut a DETAILED answer short.
- For a request to write code, give one short sentence and then a complete fenced code block.`;

// The role / company / job description / CV, as ONE message that stays the
// same for every question in the interview - the shape and labels the desktop
// app uses (context_blocks in ask.rs).
function backgroundMessage(profile: Profile): string | null {
  const blocks: string[] = [];
  if (profile.role.trim()) blocks.push(`Role being interviewed for: ${profile.role.trim()}`);
  if (profile.company.trim()) blocks.push(`Company: ${profile.company.trim()}`);
  if (profile.jobDescription.trim()) blocks.push(`Job context:\n${profile.jobDescription.trim().slice(0, MAX_JOB_DESCRIPTION_CHARS)}`);
  if (profile.resume.trim()) blocks.push(`About the candidate:\n${profile.resume.trim().slice(0, MAX_RESUME_CHARS)}`);
  if (blocks.length === 0) return null;
  return `SUPPORTING BACKGROUND for this interview session (optional — use only what is relevant to whatever question comes next; it is not a limit on what you can answer, and it must never be mentioned or referred to as a source):\n\n${blocks.join("\n\n")}`;
}

const BACKGROUND_ACK = "Got it — I'll keep that in mind while answering.";

function buildMessages(profile: Profile, history: QA[], question: string): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
  const background = backgroundMessage(profile);
  if (background) {
    messages.push({ role: "user", content: background });
    messages.push({ role: "assistant", content: BACKGROUND_ACK });
  }
  for (const turn of history.slice(-HISTORY_TURNS)) {
    messages.push({ role: "user", content: turn.question });
    messages.push({ role: "assistant", content: turn.answer });
  }
  messages.push({ role: "user", content: `${question}\n\nANSWER LENGTH for this question: ${LENGTH_INSTRUCTION[answerDepth(question)]}` });
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
    TOKEN_BUDGET[answerDepth(question)],
    sessionId,
    (delta) => {
      text += delta;
      onText(text);
    },
    signal,
  );
  return text;
}

/** What gets stored in the conversation history and the summary: the answer as spoken. */
export function spokenAnswer(raw: string): string {
  return raw.trim();
}
