// The phone's microphone hears the candidate's own answers as well as the
// interviewer (there is no separate system-audio channel like on desktop), so
// Auto AI can't treat every finished turn as a question. This is a cheap
// surface check for "does this sound like the interviewer asking or
// requesting something" — everything else is still shown in the transcript,
// and can be answered with one tap.

const OPENERS = [
  "what", "why", "how", "when", "where", "who", "which", "whose",
  "can you", "could you", "would you", "will you", "do you", "did you", "have you", "are you", "is there", "is it",
  "tell me", "walk me", "talk me", "take me", "explain", "describe", "give me", "show me", "write", "implement", "design", "compare",
  "let's", "lets", "imagine", "suppose", "say you", "so what", "so how", "so why", "and what", "and how", "and why",
];

/** Long unbroken speech is almost always the candidate answering, not a question. */
const MAX_QUESTION_WORDS = 70;

/** Interviewers often lead with filler ("Okay, great. Now explain…"); it can stack, so it's stripped repeatedly. */
const LEADING_FILLER = /^((okay|ok|alright|great|right|so|and|now|cool|nice|thanks|thank you|good|perfect)[,.!\s]+)+/;

/** How many trailing sentences are checked: the actual ask is at the end, after any preamble. */
const SENTENCES_CHECKED = 2;

function startsLikeAsk(sentence: string): boolean {
  const lowered = sentence.toLowerCase().trim().replace(LEADING_FILLER, "");
  return OPENERS.some((opener) => lowered === opener || lowered.startsWith(`${opener} `) || lowered.startsWith(`${opener},`));
}

export function looksLikeQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const words = trimmed.split(/\s+/).length;
  if (words > MAX_QUESTION_WORDS) return false;
  if (trimmed.includes("?")) return true;

  // Split after . or ! without a regex lookbehind: iOS Safari before 16.4
  // cannot parse one, and a parse error would break the whole page.
  const sentences = trimmed.match(/[^.!]+[.!]*/g) ?? [];
  return sentences.slice(-SENTENCES_CHECKED).some(startsLikeAsk);
}
