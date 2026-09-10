//! Ports `apps/backend/app/services/ask_service.py` — Interview Mode's
//! single-question "ask" flow. One LLM call, streamed. Prompt text, length/
//! format classification heuristics, and token budgets below are a faithful
//! line-for-line port of that file — see it for the full rationale behind
//! each rule; only the mechanical translation to Rust is new here.

use crate::backend::AskRequest;
use super::conversation::{classify_intent, resolution_block};
use super::ChatMessage;

pub const SYSTEM_PROMPT: &str = "FORMATTING IS MANDATORY ON EVERY REPLY: use real Markdown. Bold at least one key term with **double asterisks**. For anything with more than one point, reason, or step, use a real Markdown numbered list (\"1. \", \"2. \") or bullets (\"- \") — never one long paragraph. This applies to every single answer below, no exceptions, regardless of anything else in this prompt.

You are the candidate, live in a job interview for a role in software engineering / technology, answering out loud in your own voice. Write every answer exactly the way a well-prepared candidate would actually say it — first person, real spoken sentences, the natural rhythm of someone talking who knows the material, formatted with Markdown as instructed above so it's easy to read on screen. Never write it as a flat unformatted paragraph.

HOW TO ANSWER

Answer the question that was actually asked, using whatever gets you to the best answer:
1. The question itself is what you are answering. Nothing else outranks it.
2. Background about the candidate, when the question is about their own experience, projects, or history.
3. Role or job context, when it helps you pitch the answer at the right level.
4. Your own general knowledge of the subject, for everything else.

Background may be absent, thin, or unrelated to the question. That is normal and completely fine — it is extra material, not a boundary. When it says nothing about the topic, simply answer the question from your own knowledge, exactly as a well-prepared candidate would.

NEVER SAY ANY OF THE FOLLOWING

- \"According to your resume / CV / documents\"
- \"The provided documents indicate\"
- \"Based on the retrieved context\"
- \"I don't have enough information in the uploaded documents\"
- \"Information not found in your documents\"
- Any other reference to documents, resumes, context, retrieval, sources, or what you were or were not given.

You never reference where the answer came from. Never break that.

STYLE — SPEAK LIKE A REAL CANDIDATE, FORMATTED TO BE READ

Answer in full, natural sentences the way you'd actually say them out loud — never clipped keyword fragments. At the same time, this is read on screen during a live interview, so use real Markdown formatting to make it easy to scan at a glance: it must never look like one dense, unbroken wall of text.

NON-NEGOTIABLE FORMATTING RULES — apply these to literally every answer over one sentence, with no exceptions:
- Bold with **double asterisks** at least one key term, technology, or name in the answer — every single time, even in a two-sentence answer.
- Never write more than 2-3 sentences of prose back to back without breaking it up: once you'd be writing a 3rd/4th connected sentence in a row, either start a new paragraph (blank line) or switch to a numbered list / bullets instead of continuing the same block.
- Any answer with more than one distinct step, reason, stage, or point (i.e. anything MEDIUM tier or above) MUST use a Markdown numbered list or bullets for those points — not a single paragraph that mentions them all in a row. If you catch yourself writing \"first... then... also... finally...\" inside one paragraph, stop and make it a list instead.
- These are real Markdown lists (\"1. \", \"2. \", or \"- \" at the start of the line) and real \"**bold**\" syntax — not a description of formatting, the actual syntax, so it renders properly.

- Start with a direct answer to the question, as a real sentence, then keep going naturally from there — not a compressed keyword line.
- Write in complete, natural sentences throughout — never a bare fragment. Within those sentences, **bold** the key terms, technologies, or names that matter most (\"I used **Redis** for caching because...\") so someone scanning the answer can pick out the important nouns immediately.
- Break the answer into short paragraphs (a blank line between them) whenever it covers more than one idea — never one long unbroken block, even for a MEDIUM-length answer.
- Use a numbered list or a few bullets whenever the content is genuinely a sequence or a set of clearly separate, comparable points (steps in a process, stages of a pipeline, several distinct trade-offs, several reasons) — this is the normal case for MEDIUM/LONG/VERY LONG answers, not an exception. Every bullet or step must still read as a full, natural sentence a person would actually say — never a bare bolded label followed by a fragment (e.g. \"**Problem:** ...\"), and never a keyword-only line.
- Sound conversational and confident, the way someone talks when they actually know the material — contractions are fine (\"I'd\", \"it's\", \"didn't\"), and it's fine to build one idea into the next rather than listing everything as separate disconnected points.
- No filler, no throat-clearing, no \"so basically\", no meta-commentary (\"Great question\"), no preamble, no restating the question back before answering.
- No generic closing summary or \"in conclusion\" line — end the answer when it's actually finished, not with a wrap-up sentence.
- Once a term has been named in full once in this conversation (this turn or an earlier one), use the short form for the rest of the answer and in later turns. Say \"RAG\" after the first mention, not \"Retrieval-Augmented Generation\" every time. Use standard short forms directly — \"API\", \"DB\", \"UI\", \"ML\", \"LLM\", \"CI/CD\" — without first spelling them out unless the interviewer's own question suggests they want the expansion (e.g. they literally ask \"what does RAG stand for?\"). Don't re-define or re-explain a term already used in this conversation just because a new question touches the same topic.
- Don't explain a concept from first principles unless the question actually asks for that. If the interviewer asks something narrow, answer the narrow thing — don't back up and re-teach the broader topic it lives inside.
- Avoid corporate/report register entirely: phrases like \"ensuring they are in a format that can be processed\" or \"provide accurate and contextually relevant answers\" read like a written report, not something a person would say out loud. Say the plain, natural version instead: \"so it's usable\", \"good answers back\", \"it worked a lot better after that\".

LENGTH AND DEPTH

Before answering, classify the question into one of four depth tiers, from its wording, complexity, and the conversation so far — not from a fixed habit. Use the length guidance below as a target, not a hard cap — when in doubt, say more real substance rather than less. Even a SHORT question gets a complete, real spoken answer, not a single bare sentence with nothing behind it.

- SHORT — a factual, definitional, or direct yes/no-shaped question (\"What is X?\", \"Have you used Y?\", \"Do you know Z?\"). A direct answer sentence, then one or two more sentences of real supporting detail (what it's for, a key mechanism, or a concrete example) — never stop at just the one bare sentence. For a direct experience question (\"Have you worked on web applications?\"), lead with the direct answer (\"Yeah, I have —\") plus a sentence naming a concrete project, tool, or example — don't leave it at a bare yes.
- MEDIUM — a \"why\"/reasoning question, or a direct question that needs one layer of explanation (\"Why did you choose X?\", \"How exactly did you use Python?\"). A few connected sentences giving the real reasoning or mechanism — genuine substance, not a full essay, but never just a claim with nothing behind it.
- LONG — a request for a real explanation of a process or a specific piece of it (\"How did you implement the system?\", \"What did you use for embeddings?\" as a follow-up). A fuller explanation in connected sentences (a numbered walkthrough is fine when the steps are genuinely sequential) — genuinely earns the space, don't compress it to one line.
- VERY LONG / DETAILED — an explicit ask for the complete picture (\"Explain the complete RAG architecture\", \"Walk me through the entire implementation step by step\"). The fullest real explanation, covering every real stage in connected sentences or a numbered walkthrough — don't truncate this one to save words.
- CODE — the interviewer wants you to actually write code (\"Write a function that...\", \"Implement X in Python\", \"What would the SQL look like?\"), not talk about it. This tier is judged on completeness and correctness of the code, not a word count — see FORMAT 7 below.

- A follow-up (\"why did you choose that?\", \"what about scaling?\", \"and then?\") inherits the depth tier of the exchange it is following up on, resolved from the conversation so far — UNLESS it narrows into one specific piece (see FOLLOW-UP QUESTIONS below), in which case it drops to SHORT for that one piece regardless of how long the earlier answer was.
- A request that narrows the scope of what was just discussed (\"Can you give me an example?\", \"Just the example\", \"Can you be more specific about X?\", \"Can you explain the first step?\") drops to SHORT and answers only the narrowed thing — give the example, the one step, or the specific detail asked for, without re-explaining or restating the broader answer it came from. This is the one case where one or two sentences is correct — the interviewer explicitly asked to narrow in, not for more.
- If the interviewer's speech trails off and then continues (a pause mid-question, not a new question), treat the continuation as completing the same question — mentally merge it into one complete question before judging its tier, rather than answering the fragment on its own.

Never force a long, heavily-structured writeup onto a question that's genuinely simple. But a simple question still deserves a real, complete spoken answer — a bare one-liner with zero supporting detail reads as unprepared, not efficient. Never give a short answer when the interviewer clearly wants a detailed explanation, architecture, workflow, implementation, or step-by-step breakdown.

FORMAT

Formatting is part of the answer, not optional — but format here means real Markdown structure (bold, paragraphs, numbered lists/bullets) wrapped around real sentences, not fragments versus prose. Every answer beyond a one-line SHORT question should be visually broken up — short paragraphs, **bold** on the key terms, and a numbered list or bullets whenever there's more than one distinct point — so it reads easily on screen, not as a solid block of text. Determine the question type first, then use the matching approach below.

1. SIMPLE DEFINITION (\"What is X?\", \"Have you used Y?\"): a direct answer sentence with the key term **bolded**, then one or two more sentences of real supporting detail (what it's for, a key mechanism, or a concrete example). Plain spoken prose, no bullets needed — it's short enough not to.

2. WHY / COMPARISON (\"Why did you choose X over Y?\", \"Why does that matter?\"): a short intro sentence, then the real reasons as a bulleted list — each bullet a full natural sentence with its key term **bolded**, not a fragment. Prose-only is fine instead of bullets when there's really just one connected reason to give.

3. HOW / PROCESS (\"How did you build X?\", \"How does the pipeline work?\"): a short intro sentence, then a numbered list where every number is a complete, natural sentence describing that step, with the key tool/technique **bolded** — never a fragment.

4. ARCHITECTURE / SYSTEM DESIGN (\"Explain the architecture step by step\", \"Walk me through the system design\", \"Explain the full flow\"): a short intro sentence, then a numbered walkthrough of the real stages (data ingestion, chunking, embeddings, vector storage, retrieval, generation — using whatever stages actually apply to the system being discussed), each written as one or two full sentences with the stage's key tool/technique **bolded**. Every stage's sentence must name something concrete — \"documents get split into pieces\" for a chunking step, or \"vectors get compared\" for a ranking step, says nothing a candidate wouldn't already know from the stage name alone; say the actual thing instead — the chunk size/overlap, the embedding model, the similarity metric, the index type, the reranking approach, whatever is real and specific to that stage, drawn from the candidate's background if it establishes one and from standard real-world practice otherwise.

5. PROJECT / EXPERIENCE (\"Tell me about your project\", \"Tell me about a time...\"): tell it like a real story, broken into short paragraphs — what the problem was, what you did about it, how you did it, what you used, and how it turned out — with the key technologies **bolded** as they come up. Only when the background genuinely establishes a concrete story for it (see HONESTY below); otherwise answer in terms of the approach itself rather than forcing a fabricated problem/result.

6. ANY OTHER TECHNICAL EXPLANATION that earns real depth: short paragraphs of connected sentences with key terms **bolded**, organized into a numbered walkthrough or bullets wherever there's more than one distinct point — never one undivided wall of text for something with clearly separable parts, and never a bulleted list of bare fragments either.

7. CODE / IMPLEMENTATION REQUEST (\"Write a function that...\", \"Can you code that up?\", \"Implement X in Python\", \"What would the SQL look like?\", a LeetCode-style problem): the interviewer wants to see actual code, not a description of code. At most one short spoken framing sentence, then a single fenced Markdown code block (```python ... ``` or whatever language fits — use the language the interviewer named, or the clearest idiomatic default for the task, e.g. Python for a general algorithm, SQL for a query, bash for a shell task) containing complete, correct, properly indented code that actually solves what was asked — never pseudocode dressed up as an answer unless pseudocode is explicitly what was asked for. Optionally, one short trailing sentence after the block for a genuinely useful detail (time/space complexity, a key trade-off) — skip this entirely if there's nothing worth adding. Never describe the code in prose instead of writing it, and never wrap the explanation itself in a code block — only the code goes in the fence.

A follow-up question answers only the new point being asked, using the FORMAT that matches the follow-up itself (a narrow follow-up usually earns format 1, even if the question it follows up on used a fuller format) — see FOLLOW-UP QUESTIONS below for how to resolve what it's referring to.

WORKED EXAMPLE (format 4, architecture/system design — follow this exact shape AND this exact spoken-sentence-plus-formatting style, adapted to whatever system is actually being discussed):

Question: \"What happens when I type a URL into the browser?\"
Good answer:
\"A few things happen in sequence there.

1. First the browser resolves the domain — it checks its own cache, then the OS cache, then goes out to a **recursive resolver** if it still doesn't have an answer.
2. Once it has an IP, it opens a **TCP** connection to the server and layers **TLS** on top — **ALPN** during that handshake is what actually negotiates HTTP/2.
3. The browser sends the request, the server responds, and the browser starts parsing the HTML while building the **DOM** and **CSSOM** in parallel, then paints once it has enough to render.

Worth mentioning that subresources like images and scripts get fetched on their own separate connections around the same time.\"

Notice every step is a real sentence a person would actually say out loud — never a bare fragment or a bold label plus a phrase — the key technologies are bolded so it's easy to scan, and the last line is a short natural aside, not a summary. This is the level every format-2/3/4 (and, adapted, format-6) answer must reach: real sentences, broken into a numbered list or short paragraphs, with the important terms bolded — never a solid, unbroken block of prose, and never a bulleted list of bare fragments either.

WORKED EXAMPLE (format 7, code/implementation — follow this exact shape: one short spoken framing sentence, then real code in a fenced block, nothing more unless it adds genuine value):

Question: \"Can you write a function that checks if a string is a palindrome?\"
Good answer:
\"Sure — I'd just compare the string to its reverse.

```python
def is_palindrome(s: str) -> bool:
    cleaned = s.lower().replace(\" \", \"\")
    return cleaned == cleaned[::-1]
```

That's O(n) time and space, since I'm building the reversed copy.\"

Never answer a question like this with a paragraph describing what the function would do instead of writing it.

HONESTY

Do not invent specific employers, job titles, dates, headcounts, metrics, or named projects for the candidate. If the background does not establish a concrete personal story for what was asked, answer in terms of the subject itself and how one would approach it — that is always a real answer, and it is never a reason to say you lack information.

FOLLOW-UP QUESTIONS

This is one continuing conversation. Earlier questions and your own earlier answers are part of it, so a follow-up that refers back — \"why did you choose that?\", \"how would you scale it?\", \"what about the trade-offs?\" — is asking about what was just discussed. Resolve it from the conversation so far and answer it directly. Never ask which thing they mean, and never restate the earlier answer before getting to the new one.

A follow-up that narrows into ONE piece of something already covered — \"What did you use for embeddings?\" after the whole pipeline it's part of was already explained — gets answered as that one piece only. Do not re-explain the pipeline, do not redefine terms already used, do not open with a recap of the earlier answer. Go straight to the specific thing asked.

Example — two turns of one conversation:
Interviewer: \"How did you build the RAG system?\"
(the answer covered the full pipeline)
Interviewer: \"What did you use for embeddings?\"
Good answer: \"I used OpenAI's text-embedding-3-small for that — good quality, and cheap enough to run across the whole document set.\"
Bad answer: \"For the RAG system, we used Retrieval-Augmented Generation to combine retrieval with an LLM. For the embeddings step, we used OpenAI's text-embedding-3-small...\" (re-explains RAG and the pipeline that was already covered — never do this)

NEVER ASK FOR CLARIFICATION

You are live, on the spot, in front of an interviewer — there is no chance to pause and ask what they meant, and you must never say a term \"could mean different things\" or \"depends on the context.\" Every technical term or acronym in this interview means its software-engineering/technology sense, full stop, with no other candidate meaning worth mentioning: RAG means Retrieval-Augmented Generation. REST means Representational State Transfer. CI/CD means Continuous Integration/Continuous Deployment. Apply that same rule — one confident technical meaning, stated as fact — to any other term the interviewer uses. Open with what it is, then real supporting detail, exactly as the example below does:

Question: \"What is RAG and why would you use it?\"
Good answer: \"RAG is Retrieval-Augmented Generation — it retrieves relevant info from a knowledge base before generating a response, instead of relying only on what the model already learned during training. It's mainly useful because it improves factual accuracy and makes it a lot easier to ground answers in company-specific info.\"";

fn length_instruction(answer_length: &str) -> &'static str {
    match answer_length {
        "brief" => "Ceiling: one or two short sentences at most. A short question should still land in one or two sentences.",
        _ => "Ceiling: up to roughly 6-8 real sentences (or numbered steps) for a question that genuinely warrants real depth (e.g. \"explain step by step\"). Even a simple factual question should get a direct sentence plus a couple of real supporting sentences, not a bare one-liner. Speak naturally, in real sentences, and use Markdown formatting (bold on key terms, short paragraphs, numbered lists/bullets for anything with more than one point) so it's easy to read on screen — never a bare fragment, and never one solid unbroken block of text.",
    }
}

fn style_instruction(response_style: &str) -> &'static str {
    match response_style {
        "technical" => "Lean technical: use correct terminology precisely and name a concrete mechanism where it fits, while still sounding like something a person would actually say out loud, not a lecture.",
        "concise" => "Be efficient with words, but still speak in full, natural sentences — the shortest complete spoken answer, not a compressed fragment.",
        _ => "Natural, confident spoken sentences — the way a well-prepared candidate actually talks, not narrated notes or keyword fragments.",
    }
}

fn english_level_instruction(english_level: &str) -> &'static str {
    match english_level {
        "professional" => "Use clear, professional vocabulary appropriate for a workplace interview — correct and precise, still spoken as natural sentences.",
        "advanced" => "You may use more advanced/precise vocabulary where it genuinely fits, but it should still sound like natural speech, not a written paper.",
        _ => "Use SIMPLE, EVERYDAY WORDS — the vocabulary an ordinary person uses when talking, not a textbook, a report, or a corporate memo. If there's a short, plain, common word for something, use that instead of the fancier one, even if the fancier one is technically more \"correct\" — say \"uses\" not \"utilizes\", \"helps\" not \"facilitates\", \"start\" not \"initiate\", \"a lot\" not \"significantly\", \"good\" not \"robust\"/\"optimal\", \"send\" not \"transmit\", \"works well with\" not \"complements\"/\"synergizes with\". Avoid stacked abstract nouns and formal connective phrases (\"combines the strengths of\", \"in order to\", \"leverages\", \"encompasses\", \"facilitates\", \"in the context of\", \"with respect to\") — say the same thing the way you'd actually say it out loud to a friend. Technical terms/names (RAG, API, the actual tool or model name) stay exactly as they are — this is about the plain words wrapped around them, not dumbing down the substance.",
    }
}

fn humanization_instruction(humanization: &str) -> &'static str {
    match humanization {
        "conversational" => "A bit of natural personality and warmth is welcome throughout — this should sound like a real person talking, not a recitation.",
        "formal" => "Lean a little more precise and measured in word choice, while still reading as something a person would actually say out loud.",
        _ => "Plain, neutral, natural spoken word choice — a real person answering, not a generated-sounding narrative.",
    }
}

const HOW_PROCESS_MARKERS: &[&str] = &["how did you build", "how does", "how do you", "how did you implement", "how did you create", "walk me through", "walk us through", "describe how you", "explain how you"];
const ARCHITECTURE_MARKERS: &[&str] = &["architecture", "system design", "design of the system", "step by step", "step-by-step", "pipeline", "full flow", "entire flow", "whole flow", "complete flow", "the flow", "workflow"];
const VERY_LONG_SCOPE_WORDS: &[&str] = &["complete", "entire", "whole", "full"];
const VERY_LONG_TOPIC_WORDS: &[&str] = &["architecture", "implementation", "system", "pipeline", "design", "flow", "workflow"];
const VERY_LONG_PHRASES: &[&str] = &["from start to finish", "beginning to end", "in full detail", "in complete detail", "end to end", "end-to-end"];
const WHY_COMPARISON_MARKERS: &[&str] = &["why did you", "why do you", "why does", "why is", "compare", "versus", " vs ", "instead of", "rather than"];
const PROJECT_MARKERS: &[&str] = &["tell me about a project", "tell me about your project", "walk me through your project", "tell me about a time", "describe a project"];
const ENUMERATION_WORDS: &[&str] = &["types", "type", "kinds", "kind", "categories", "category", "methods", "approaches", "techniques"];
const DEFINITION_OPENERS: &[&str] = &["what is", "what are", "what's", "define", "have you used", "have you worked with", "do you know"];
const NARROW_FOLLOWUP_MARKERS: &[&str] = &[
    "what did you use for",
    "what about the",
    "what about",
    "and what about",
    "explain the first step",
    "explain that step",
    "just that step",
    "only the first",
    "just the first",
];
const DIRECT_EXPERIENCE_MARKERS: &[&str] = &["have you worked", "have you used", "have you built", "do you have experience", "are you familiar with"];
const EXAMPLE_SCOPE_MARKERS: &[&str] = &["give me an example", "just the example", "just give the example", "can you be more specific", "just that part"];
// Explicit signals that the interviewer wants runnable code back, not a
// spoken explanation of code — either a direct "write/implement/code" verb,
// a named programming language, or a recognizable coding-interview phrasing.
const CODE_MARKERS: &[&str] = &[
    "write a function", "write a program", "write a script", "write a query",
    "write the code", "write some code", "write code", "code that up", "code up",
    "write pseudocode", "write an algorithm", "write a regex", "write sql",
    "implement a function", "implement the function", "implement a program",
    "coding question", "coding problem", "coding challenge", "leetcode",
    "reverse a linked list", "in python", "in javascript", "in typescript",
    "in java", "in c++", "in golang", "in rust", "using python", "using javascript",
    "using sql", "what would the sql", "what would the code", "how would you code",
];

/// Whole-word containment check — plain substring `contains` would match
/// "type" inside "prototype" or "types" inside "stereotypes", which
/// `ENUMERATION_WORDS`' single-word markers need to avoid.
fn word_in(text: &str, word: &str) -> bool {
    let bytes = word.as_bytes();
    let mut start = 0;
    while let Some(pos) = text[start..].find(word) {
        let abs = start + pos;
        let before_ok = text[..abs].chars().next_back().map(|c| !c.is_alphanumeric()).unwrap_or(true);
        let after_idx = abs + bytes.len();
        let after_ok = text[after_idx..].chars().next().map(|c| !c.is_alphanumeric()).unwrap_or(true);
        if before_ok && after_ok {
            return true;
        }
        start = abs + 1;
        if start >= text.len() {
            break;
        }
    }
    false
}

fn classify_format(question: &str) -> Option<&'static str> {
    let lowered = question.to_lowercase();

    if NARROW_FOLLOWUP_MARKERS.iter().any(|m| lowered.contains(m)) || EXAMPLE_SCOPE_MARKERS.iter().any(|m| lowered.contains(m)) {
        return Some("FORMAT 1-STYLE (narrow follow-up): answer only the specific piece asked about, in one or two direct spoken sentences. No lists, no recap of the broader topic it's part of.");
    }
    if CODE_MARKERS.iter().any(|m| lowered.contains(m)) {
        return Some("FORMAT 7 (code/implementation): at most one short spoken framing sentence, then a single fenced Markdown code block (```language ... ```) with complete, correct, runnable code that actually solves what was asked, then optionally one short trailing sentence only if genuinely useful (e.g. complexity). Never describe the code in prose instead of writing it.");
    }
    if ARCHITECTURE_MARKERS.iter().any(|m| lowered.contains(m)) {
        return Some("FORMAT 4 (architecture/system design): a short intro sentence, then a numbered walkthrough (1. 2. 3. ...) where every step is one or two full spoken sentences naming something concrete for that stage. Do not write this as a single paragraph, and never reduce a step to a bare fragment or bold label.");
    }
    if PROJECT_MARKERS.iter().any(|m| lowered.contains(m)) {
        return Some("FORMAT 5 (project/experience): tell it as a real story in connected sentences — the problem, what you did, how you did it, what you used, and how it turned out. Do not use bold labels or fragments; say it the way you'd actually tell it.");
    }
    if HOW_PROCESS_MARKERS.iter().any(|m| lowered.contains(m)) {
        return Some("FORMAT 3 (how/process): walk through it as connected sentences, or a numbered list (1. 2. 3. ...) where every step is a full sentence describing what happens. Do not write this as a single undivided paragraph, and never reduce a step to a fragment.");
    }
    if WHY_COMPARISON_MARKERS.iter().any(|m| lowered.contains(m)) {
        return Some("FORMAT 2 (why/comparison): a few connected sentences giving the real reasons, with genuine substance behind each one — natural prose, or short full-sentence bullets only if there are several distinct reasons worth separating out.");
    }
    if ENUMERATION_WORDS.iter().any(|w| word_in(&lowered, w)) {
        return Some("FORMAT 4-STYLE (enumeration): a short sentence naming how many there are, then a numbered list (1. 2. 3. ...) — one named item per line, each explained in a full sentence, not just named.");
    }
    if DEFINITION_OPENERS.iter().any(|o| lowered.starts_with(o)) {
        return Some("FORMAT 1 (simple definition): a direct answer sentence, then one or two more sentences of real supporting detail — don't stop at the one bare sentence.");
    }

    None
}

struct LengthTarget {
    prompt_text: &'static str,
    max_tokens: u32,
}

fn length_target(tier: &str) -> LengthTarget {
    match tier {
        "narrow_followup" => LengthTarget {
            prompt_text: "SHORT/MEDIUM (one or two full spoken sentences) — this zooms into ONE piece of something already covered. Answer only that piece — no recap of the broader topic, no re-defining terms already used in this conversation.",
            max_tokens: 110,
        },
        "example" => LengthTarget {
            prompt_text: "SHORT (one short spoken sentence) — answer only the narrowed thing asked for (e.g. just the example). Stop there even if the ceiling below allows more.",
            max_tokens: 80,
        },
        "direct_experience" => LengthTarget {
            prompt_text: "SHORT (a direct \"Yeah, I have —\" sentence plus one or two sentences naming a concrete project, tool, or example) — a bare yes isn't enough; give one real, specific detail. Still don't turn this into a full story unless the interviewer's next question asks for more.",
            max_tokens: 150,
        },
        "short" => LengthTarget {
            prompt_text: "SHORT (a direct answer sentence plus one or two more sentences of real supporting detail) — a bare one-liner with nothing behind it isn't a complete answer.",
            max_tokens: 150,
        },
        "long" => LengthTarget {
            prompt_text: "LONG (a short intro sentence plus roughly 4-7 real sentences or numbered steps) — this genuinely earns the fuller explanation per the FORMAT above; do not compress it.",
            max_tokens: 450,
        },
        "code" => LengthTarget {
            prompt_text: "CODE (word count doesn't apply) — at most one short spoken framing sentence, then complete, correct, runnable code in a fenced block, then at most one short trailing sentence only if genuinely useful. Don't pad with unnecessary explanation, but never truncate the code itself to save space — a partial or pseudocode answer is not acceptable when real code was asked for.",
            max_tokens: 500,
        },
        "very_long" => LengthTarget {
            prompt_text: "VERY LONG / DETAILED (a short intro sentence plus roughly 6-9 real sentences or numbered steps) — the interviewer explicitly asked for the complete picture. Give the fullest real explanation, covering every real stage — don't truncate this one to save words.",
            max_tokens: 700,
        },
        "unclassified" => LengthTarget {
            prompt_text: DEFAULT_JUDGE_TEXT,
            // Nothing in the question matched a known short/medium pattern, so
            // this could genuinely be a LONG or VERY LONG question phrased in a
            // way the keyword lists don't cover (e.g. "walk me through the
            // system you built", "tell me about the design of X"). Give the
            // model the same headroom as an explicit LONG classification and
            // let its own depth judgment (see LENGTH AND DEPTH in the system
            // prompt) decide how much of it to actually use — capping this at
            // MEDIUM's budget would truncate a real deep-dive answer before
            // the model could write it, regardless of what it judged. Kept
            // equal to the "long" tier's budget above.
            max_tokens: 450,
        },
        _ => LengthTarget {
            prompt_text: "MEDIUM (a short intro sentence plus roughly 3-6 real sentences) — this is a reasoning/why question and deserves real substance, not just a token nod to the choice. Give the actual mechanism or trade-off behind the reasoning, not just a label of it.",
            max_tokens: 220,
        },
    }
}

const DEFAULT_JUDGE_TEXT: &str = "Judge SHORT/MEDIUM/LONG/VERY LONG from the question's own wording, per LENGTH AND DEPTH above.";

fn classify_length(question: &str) -> (&'static str, u32) {
    let lowered = question.to_lowercase();

    if NARROW_FOLLOWUP_MARKERS.iter().any(|m| lowered.contains(m)) {
        let t = length_target("narrow_followup");
        return (t.prompt_text, t.max_tokens);
    }
    if EXAMPLE_SCOPE_MARKERS.iter().any(|m| lowered.contains(m)) {
        let t = length_target("example");
        return (t.prompt_text, t.max_tokens);
    }
    if CODE_MARKERS.iter().any(|m| lowered.contains(m)) {
        let t = length_target("code");
        return (t.prompt_text, t.max_tokens);
    }
    if DIRECT_EXPERIENCE_MARKERS.iter().any(|o| lowered.starts_with(o)) {
        let t = length_target("direct_experience");
        return (t.prompt_text, t.max_tokens);
    }
    if ENUMERATION_WORDS.iter().any(|w| word_in(&lowered, w)) {
        let t = length_target("long");
        return (t.prompt_text, t.max_tokens);
    }
    if DEFINITION_OPENERS.iter().any(|o| lowered.starts_with(o)) {
        let t = length_target("short");
        return (t.prompt_text, t.max_tokens);
    }
    let is_explicit_very_long_phrase = VERY_LONG_PHRASES.iter().any(|m| lowered.contains(m));
    let has_scope_word = VERY_LONG_SCOPE_WORDS.iter().any(|w| lowered.contains(w));
    let has_topic_word = VERY_LONG_TOPIC_WORDS.iter().any(|w| lowered.contains(w));
    if is_explicit_very_long_phrase || (has_scope_word && has_topic_word) {
        let t = length_target("very_long");
        return (t.prompt_text, t.max_tokens);
    }
    if ARCHITECTURE_MARKERS.iter().any(|m| lowered.contains(m)) {
        let t = length_target("long");
        return (t.prompt_text, t.max_tokens);
    }
    if HOW_PROCESS_MARKERS.iter().any(|m| lowered.contains(m)) || PROJECT_MARKERS.iter().any(|m| lowered.contains(m)) {
        let t = length_target("long");
        return (t.prompt_text, t.max_tokens);
    }
    if WHY_COMPARISON_MARKERS.iter().any(|m| lowered.contains(m)) {
        let t = length_target("medium");
        return (t.prompt_text, t.max_tokens);
    }

    let t = length_target("unclassified");
    (t.prompt_text, t.max_tokens)
}

fn context_blocks(request: &AskRequest) -> Vec<String> {
    let mut blocks = Vec::new();

    if let Some(role) = &request.role {
        blocks.push(format!("Role being interviewed for: {role}"));
    }
    if let Some(company) = &request.company {
        blocks.push(format!("Company: {company}"));
    }
    if let Some(jd) = &request.job_description {
        blocks.push(format!("Job context:\n{jd}"));
    }
    if let Some(ctx) = &request.candidate_context {
        blocks.push(format!("About the candidate:\n{ctx}"));
    }
    if let Some(extra) = &request.additional_context {
        blocks.push(format!("Additional context:\n{extra}"));
    }

    blocks
}

/// The role/job-description/résumé/additional-context block, when there is
/// one — split out of `build_user_prompt` into its own message (see
/// `build_messages`) because, unlike the question, it stays byte-identical
/// across every question in an interview session and so is worth an
/// explicit cache breakpoint: folded into the per-question message like it
/// used to be, it got fully reprocessed on every single question.
pub(crate) fn build_background_message(request: &AskRequest) -> Option<String> {
    let blocks = context_blocks(request);
    if blocks.is_empty() {
        return None;
    }
    Some(format!(
        "SUPPORTING BACKGROUND for this interview session (optional — use only what is relevant to whatever question comes next; it is not a limit on what you can answer, and it must never be mentioned or referred to as a source):\n\n{}",
        blocks.join("\n\n")
    ))
}

/// Constant placeholder reply completing the cached background message's
/// turn — Anthropic's Messages API requires strictly alternating user/
/// assistant roles, so the background can't just sit as a second consecutive
/// user message before conversation history (or the current question) picks
/// back up. Never shown to the user; its exact wording doesn't matter beyond
/// staying constant, which keeping it as a fixed string guarantees.
pub(crate) const BACKGROUND_ACK: &str = "Got it — I'll keep that in mind while answering.";

fn build_user_prompt(request: &AskRequest) -> String {
    let mut parts: Vec<String> = Vec::new();

    parts.push(format!("The interviewer asks:\n{}", request.question));

    // Resolve the question against the conversation so far BEFORE the
    // format/length instructions below, so the model sees "here is what this
    // question is actually asking about" before it starts reasoning about
    // how to shape the answer. See `prompts::conversation` for why this
    // exists — the model's own inference from raw replayed history alone
    // was not reliable enough for short, bare-noun follow-ups.
    let intent = classify_intent(&request.question, !request.conversation_history.is_empty());
    if let Some(block) = resolution_block(intent, request.conversation_state.as_ref(), request.conversation_history.last()) {
        parts.push(block);
    }

    let format_line = match classify_format(&request.question) {
        Some(hint) => format!("{hint}\n\n"),
        None => "Pick the matching FORMAT from the system prompt above.\n\n".to_string(),
    };
    let (length_hint, _budget) = classify_length(&request.question);

    parts.push(format!(
        "{format_line}TARGET LENGTH FOR THIS SPECIFIC QUESTION (the binding instruction — follow this number, not a habit of always answering the same length): {length_hint}\n(User's overall ceiling, only relevant if it would push you shorter than the target above: {})\n\n{} {} {}\n\nReply with the answer only, using that exact format and hitting that target length — two answers to different questions should read as clearly different lengths, not the same length every time. Remember the NON-NEGOTIABLE FORMATTING RULES: real **bold** on at least one key term, and a real Markdown numbered list or bullets instead of a run-on paragraph for anything with more than one point.",
        length_instruction(&request.answer_length),
        style_instruction(&request.response_style),
        english_level_instruction(&request.english_level),
        humanization_instruction(&request.humanization),
    ));

    parts.join("\n\n---\n\n")
}

/// system prompt -> prior turns (replayed as real user/assistant messages,
/// not flattened text) -> the current question with its supporting-context
/// and length/format instructions.
pub fn build_messages(request: &AskRequest) -> Vec<ChatMessage> {
    let mut messages = vec![ChatMessage::system(SYSTEM_PROMPT)];

    if let Some(background) = build_background_message(request) {
        messages.push(ChatMessage::cacheable_user(background));
        messages.push(ChatMessage::assistant(BACKGROUND_ACK));
    }

    for turn in &request.conversation_history {
        messages.push(ChatMessage::user(turn.question.clone()));
        messages.push(ChatMessage::assistant(turn.answer.clone()));
    }

    messages.push(ChatMessage::user(build_user_prompt(request)));
    messages
}

/// The question's own wording sets the primary budget; a "brief" ceiling can
/// only shrink it further, never inflate a SHORT/MEDIUM question or clip a
/// LONG one down.
pub fn max_tokens_for_question(request: &AskRequest) -> u32 {
    let (_prompt_text, question_budget) = classify_length(&request.question);
    if request.answer_length == "brief" {
        question_budget.min(120)
    } else {
        question_budget
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::ConversationTurn;

    fn base_request(question: &str) -> AskRequest {
        AskRequest {
            question: question.to_string(),
            conversation_history: vec![],
            candidate_context: None,
            role: None,
            company: None,
            job_description: None,
            additional_context: None,
            answer_length: "default".to_string(),
            response_style: "natural".to_string(),
            english_level: "simple".to_string(),
            humanization: "natural".to_string(),
            llm_provider: None,
            conversation_state: None,
        }
    }

    #[test]
    fn classifies_definition_question_as_short() {
        let (_, budget) = classify_length("What is Kubernetes?");
        assert_eq!(budget, 150);
    }

    #[test]
    fn classifies_architecture_question_as_long() {
        let (_, budget) = classify_length("Explain the architecture step by step");
        assert_eq!(budget, 450);
    }

    #[test]
    fn classifies_explicit_full_picture_as_very_long() {
        let (_, budget) = classify_length("Walk me through the complete architecture");
        assert_eq!(budget, 700);
    }

    #[test]
    fn narrow_followup_overrides_topic_markers() {
        // Shares "embeddings"-adjacent phrasing with a bigger topic but must
        // stay narrow per the Python reference's ordering.
        let (_, budget) = classify_length("What did you use for embeddings?");
        assert_eq!(budget, 110);
    }

    #[test]
    fn enumeration_word_is_whole_word_only() {
        // "prototype" must not match the "type" marker — it should fall
        // through to the unclassified default instead of an enumeration match.
        let (prompt_text, _) = classify_length("Tell me about your prototype");
        assert_eq!(prompt_text, DEFAULT_JUDGE_TEXT);
    }

    #[test]
    fn enumeration_word_matches_whole_word() {
        let (_, budget) = classify_length("What are the types of caching?");
        assert_eq!(budget, 450);
    }

    #[test]
    fn brief_answer_length_clamps_but_never_inflates() {
        let mut req = base_request("Explain the architecture step by step");
        req.answer_length = "brief".to_string();
        assert_eq!(max_tokens_for_question(&req), 120);

        let mut req2 = base_request("What is Rust?");
        req2.answer_length = "brief".to_string();
        assert_eq!(max_tokens_for_question(&req2), 120); // question budget (150) clamped down to the brief ceiling
    }

    #[test]
    fn default_and_detailed_never_inflate_budget() {
        let mut req = base_request("What is Rust?");
        req.answer_length = "detailed".to_string();
        assert_eq!(max_tokens_for_question(&req), 150);
    }

    #[test]
    fn classifies_code_request_with_code_format_and_budget() {
        let hint = classify_format("Can you write a function that checks if a string is a palindrome?");
        assert!(hint.unwrap().contains("FORMAT 7"));
        let (_, budget) = classify_length("Can you write a function that checks if a string is a palindrome?");
        assert_eq!(budget, 500);
    }

    #[test]
    fn classifies_language_named_question_as_code() {
        let hint = classify_format("How would you reverse a linked list in Python?");
        assert!(hint.unwrap().contains("FORMAT 7"));
    }

    #[test]
    fn code_request_takes_priority_over_how_process_marker() {
        // Shares "how" phrasing with HOW_PROCESS_MARKERS but is a literal
        // code request, which must win.
        let hint = classify_format("How would you code a binary search in Java?");
        assert!(hint.unwrap().contains("FORMAT 7"));
    }

    #[test]
    fn context_blocks_omit_empty_sections_entirely() {
        let req = base_request("What is RAG?");
        assert!(context_blocks(&req).is_empty());
    }

    #[test]
    fn build_messages_replays_history_as_real_turns() {
        let mut req = base_request("Why did you choose that?");
        req.conversation_history = vec![ConversationTurn {
            question: "How did you build the RAG system?".to_string(),
            answer: "I used a vector database.".to_string(),
        }];
        let messages = build_messages(&req);
        assert_eq!(messages.len(), 4); // system, user(hist q), assistant(hist a), user(current)
        assert_eq!(messages[0].role, "system");
        assert_eq!(messages[1].role, "user");
        assert_eq!(messages[1].content, "How did you build the RAG system?");
        assert_eq!(messages[2].role, "assistant");
        assert_eq!(messages[2].content, "I used a vector database.");
        assert_eq!(messages[3].role, "user");
    }

    #[test]
    fn build_messages_inserts_cacheable_background_pair_when_context_present() {
        let mut req = base_request("What is Rust?");
        req.role = Some("Backend Engineer".to_string());
        let messages = build_messages(&req);
        // system, cacheable user(background), assistant(ack), user(question) — no history.
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[1].role, "user");
        assert!(messages[1].cacheable);
        assert!(messages[1].content.contains("Backend Engineer"));
        assert_eq!(messages[2].role, "assistant");
        assert!(!messages[2].cacheable);
        assert_eq!(messages[3].role, "user");
        assert!(!messages[3].cacheable);
        assert!(!messages[3].content.contains("Backend Engineer")); // moved out of the per-question message
    }

    #[test]
    fn build_messages_injects_resolution_block_for_bare_followup() {
        use crate::backend::ConversationStateSnapshot;

        let mut req = base_request("tech stack?");
        req.conversation_history = vec![ConversationTurn {
            question: "Tell me about your projects".to_string(),
            answer: "I built a Security Co-pilot project.".to_string(),
        }];
        req.conversation_state = Some(ConversationStateSnapshot {
            current_topic: None,
            current_entity: Some("Security Co-pilot project".to_string()),
            referenced_entities: vec![],
        });

        let messages = build_messages(&req);
        let current_question_message = messages.last().unwrap();
        assert!(current_question_message.content.contains("FOLLOW-UP"));
        assert!(current_question_message.content.contains("Security Co-pilot project"));
    }

    #[test]
    fn build_messages_has_no_resolution_block_for_first_question() {
        let req = base_request("tech stack?");
        let messages = build_messages(&req);
        let current_question_message = messages.last().unwrap();
        assert!(!current_question_message.content.contains("CONVERSATION CONTEXT"));
    }

    #[test]
    fn build_messages_omits_background_pair_when_no_context() {
        let req = base_request("What is Rust?");
        let messages = build_messages(&req);
        // system, user(question) only — nothing to cache.
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1].role, "user");
        assert!(!messages[1].cacheable);
    }
}
