// The phone's microphone hears the candidate's own answers as well as the
// interviewer (there is no separate system-audio channel like on desktop), so
// Auto ans can't treat every finished turn as a question. This is a cheap
// surface check for "does this sound like the interviewer asking or
// requesting something". Everything else is still shown in the transcript,
// and can be answered with one tap.
//
// It has to cope with how interviewers really talk, not just textbook
// questions: contractions ("What's…"), requests that aren't questions
// ("Tell us about…", "I'd like you to explain…"), yes/no questions
// ("Is Kafka better…"), and a question tacked on after a comment
// ("Your resume mentions Kafka, can you explain how you used it").

/** Long unbroken speech is almost always the candidate answering, not a question. */
const MAX_QUESTION_WORDS = 70;

/** How many trailing sentences are checked: the actual ask is at the end, after any preamble. */
const SENTENCES_CHECKED = 2;

/** Interviewers often lead with filler ("Okay, great. Now, please explain…"); it can stack, so it's stripped repeatedly. */
const LEADING_FILLER = /^((okay|ok|alright|great|right|so|and|now|cool|nice|thanks|thank you|good|perfect|well|then|next|also|please)[,.!\s]+)+/;

// "what / how / why …", including "what's", "how's", "whats".
const INTERROGATIVE = /^(what|whats|how|hows|why|who|whos|when|where|wheres|which|whose)(['’](s|re|d|ll|ve))?\b/;

// A wh-word followed by "I / we / my / our", or "happened", is the candidate
// telling a story ("What I did was…", "What happened was…", "How we solved it
// was…"), not asking one.
const FIRST_PERSON_WH =
  /^(what|how|why|when|where|who|which)\s+(i|we|my|our|i['’](d|m|ve|ll)|we['’](d|re|ve|ll)|happened|(the|that|this)\s+(problem|issue|reason|idea|thing|point)\s+(is|was))\b/;

// Yes/no questions: "Is Kafka better…", "Do you know…", "Have you used…".
const AUXILIARY = /^(is|are|was|were|do|does|did|can|could|would|should|will|have|has)\b/;

// Requests phrased as commands: "Tell us…", "Walk me through…", "Introduce yourself".
const IMPERATIVE =
  /^(tell (me|us)|walk (me|us)|talk (me|us|to me|about)|take (me|us)|give (me|us)|show (me|us)|share|describe|explain|define|discuss|elaborate|introduce|compare|contrast|differentiate|list|name|write|implement|design|code|solve|build|create|suggest|recommend|justify|outline|summari[sz]e|clarify|expand|say|imagine|suppose|consider|assume|let['’]?s|let us)\b/;

// "I'd like you to…", "I want you to…", "I would love for you to…".
const POLITE_REQUEST = /^(i['’]?d|i would|i)\s+(like|love|want|need)\s+(for\s+)?(you|us)\s+to\b/;

// A request tacked on after a comment: "…mentions Kafka, can you explain how…".
const REQUEST_AFTER_COMMA = /^((can|could|would|will|do|did|have|are|is)\s+you\b|tell (me|us)\b|walk (me|us)\b|explain\b|describe\b)/;

function stripFiller(text: string): string {
  return text.toLowerCase().trim().replace(LEADING_FILLER, "");
}

function startsLikeAsk(sentence: string): boolean {
  const lowered = stripFiller(sentence);
  if (FIRST_PERSON_WH.test(lowered)) return false;
  return INTERROGATIVE.test(lowered) || AUXILIARY.test(lowered) || IMPERATIVE.test(lowered) || POLITE_REQUEST.test(lowered);
}

function hasRequestAfterComma(sentence: string): boolean {
  return sentence
    .split(/[,;]\s+/)
    .slice(1)
    .some((part) => REQUEST_AFTER_COMMA.test(stripFiller(part)));
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
  return sentences.slice(-SENTENCES_CHECKED).some((sentence) => startsLikeAsk(sentence) || hasRequestAfterComma(sentence));
}
