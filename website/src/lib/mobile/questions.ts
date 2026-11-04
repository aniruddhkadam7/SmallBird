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

  // Only the end matters: an interviewer's question often comes after a long
  // lead-in, and what was said earlier is not what needs answering now.
  // Split after . or ! without a regex lookbehind: iOS Safari before 16.4
  // cannot parse one, and a parse error would break the whole page.
  const sentences = trimmed.match(/[^.!]+[.!]*/g) ?? [];
  const tail = sentences.slice(-SENTENCES_CHECKED);
  const tailWords = tail.join(" ").split(/\s+/).length;
  if (tailWords > MAX_QUESTION_WORDS) return false;
  if (tail.some((sentence) => sentence.includes("?"))) return true;
  return tail.some((sentence) => startsLikeAsk(sentence) || hasRequestAfterComma(sentence));
}

// Things said to be polite rather than to be answered.
const ACKNOWLEDGEMENT_START =
  /^(thanks|thank you|thank|great|good|nice|perfect|awesome|excellent|interesting|understood|got it|makes sense|that makes sense|sounds good|sure|okay|ok|alright|right|yes|yeah|yep|yup|no|nope|hello|hi|hey|welcome|bye|goodbye|congrat|well done|fair enough|noted|cool|lovely|wonderful|fantastic|absolutely|exactly|correct|indeed|likewise|pleasure|go on|go ahead|carry on|continue|proceed|next|please|take your time)\b/;

// The candidate talking about themselves, or stalling, rather than being asked something.
const CANDIDATE_START =
  /^(i|i['’](m|ve|d|ll)|we|we['’](re|ve|d|ll)|my|our|me|let me|give me a (second|moment|sec|minute)|one (second|moment|sec)|hmm+|um+|uh+|er+|basically|actually|honestly|to be honest|as i (said|mentioned)|in my|when i|so i|so we|and i|and we|but i|but we)\b/;

// Someone saying "I / my / we / our" anywhere is talking about themselves, which
// is the candidate. An interviewer's prompt is about "you" (or has no pronoun).
const FIRST_PERSON_ANYWHERE = /\b(i|i['’](m|ve|d|ll)|me|my|mine|myself|we|we['’](re|ve|d|ll)|our|ours|us)\b/;

const MIN_PROMPT_WORDS = 2;
const MAX_PROMPT_WORDS = 25;

/**
 * Should Auto ans answer this turn? Yes for anything that looks like a
 * question or request. Also yes for a short turn that is clearly not the
 * candidate and not a pleasantry, because interviewers often speak in
 * fragments ("Kafka experience.", "Your thoughts on microservices.") and an
 * unanswered question costs far more during a live interview than one
 * needless answer, which is simply replaced by the next.
 */
export function shouldAutoAnswer(text: string): boolean {
  if (looksLikeQuestion(text)) return true;

  const lowered = text.toLowerCase().trim();
  const words = lowered.split(/\s+/).length;
  if (words < MIN_PROMPT_WORDS || words > MAX_PROMPT_WORDS) return false;
  if (ACKNOWLEDGEMENT_START.test(lowered)) return false;
  if (CANDIDATE_START.test(lowered)) return false;
  if (FIRST_PERSON_ANYWHERE.test(lowered)) return false;
  return true;
}
