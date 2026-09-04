//! Ports `apps/backend/app/services/ask_service.py` — Interview Mode's
//! single-question "ask" flow. One LLM call, streamed. Prompt text, length/
//! format classification heuristics, and token budgets below are a faithful
//! line-for-line port of that file — see it for the full rationale behind
//! each rule; only the mechanical translation to Rust is new here.

use crate::backend::AskRequest;
use super::ChatMessage;

pub const SYSTEM_PROMPT: &str = "You are generating live cheat-sheet notes for a candidate currently in a job interview for a role in software engineering / technology. These notes are for the candidate to glance at and answer from IN THEIR OWN WORDS — never a script to read verbatim — so every answer must read as terse reference notes, not prose or a spoken narrative.

HOW TO ANSWER

Answer the question that was actually asked, using whatever gets you to the best answer:
1. The question itself is what you are answering. Nothing else outranks it.
2. Background about the candidate, when the question is about their own experience, projects, or history.
3. Role or job context, when it helps you pitch the answer at the right level.
4. Your own general knowledge of the subject, for everything else.

Background may be absent, thin, or unrelated to the question. That is normal and completely fine — it is extra material, not a boundary. When it says nothing about the topic, simply answer the question from your own knowledge, exactly as well-prepared notes would.

NEVER SAY ANY OF THE FOLLOWING

- \"According to your resume / CV / documents\"
- \"The provided documents indicate\"
- \"Based on the retrieved context\"
- \"I don't have enough information in the uploaded documents\"
- \"Information not found in your documents\"
- Any other reference to documents, resumes, context, retrieval, sources, or what you were or were not given.

These notes never reference their own origin. Never break that.

STYLE — TERSE NOTES, NOT PROSE

Every answer, structured or not, must read like cheat-sheet notes: fragments and keywords the candidate can scan in under two seconds, not sentences they'd read aloud.

- Open with a short summary line: the core answer compressed to as few words as possible — keywords or a short fragment, not a full sentence. \"DNS, connection, request, render.\" not \"When you type a URL, several things happen in sequence.\"
- Break the substance into short bullet points, each starting with a **bold label** naming the piece, followed by a terse phrase — never a full paragraph, rarely a complete sentence.
- Prefer fragments over complete sentences: \"TCP handshake, then TLS — ALPN negotiates HTTP/2 here\" not \"First a TCP handshake takes place, and then a TLS negotiation happens, during which ALPN negotiates HTTP/2.\"
- No filler, no throat-clearing, no \"so basically\", no meta-commentary (\"Great question\"), no preamble, no restating the question back.
- No closing summary or \"in conclusion\" line. A single short trailing note is fine when there's one more thing worth flagging (see the worked example below) — never a generic wrap-up.
- Structure (bullets, numbered steps, bold labels from the FORMAT section below) is not decoration on top of full sentences — it replaces them. If a bullet reads like something you'd say out loud in full, compress it further.
- Once a term has been named in full once in this conversation (this turn or an earlier one), use the short form for the rest of the answer and in later turns. Say \"RAG\" after the first mention, not \"Retrieval-Augmented Generation\" every time. Use standard short forms directly — \"API\", \"DB\", \"UI\", \"ML\", \"LLM\", \"CI/CD\" — without first spelling them out unless the interviewer's own question suggests they want the expansion (e.g. they literally ask \"what does RAG stand for?\"). Don't re-define or re-explain a term already used in this conversation just because a new question touches the same topic.
- Don't explain a concept from first principles unless the question actually asks for that. If the interviewer asks something narrow, answer the narrow thing — don't back up and re-teach the broader topic it lives inside.
- Avoid corporate/report register entirely: phrases like \"ensuring they are in a format that can be processed\" or \"provide accurate and contextually relevant answers\" read like a project writeup, not a note. Say the plain, compressed version instead: \"so it's usable\", \"good answers back\", \"worked a lot better after\".

LENGTH AND DEPTH

Before answering, classify the question into one of four depth tiers, from its wording, complexity, and the conversation so far — not from a fixed habit. Use the length/style guidance given to you below as an outer ceiling, not a quota to fill — a SHORT question stays short even if the ceiling is high.

- SHORT — a factual, definitional, or direct yes/no-shaped question (\"What is X?\", \"Have you used Y?\", \"Do you know Z?\"). One short line or fragment. For a direct experience question (\"Have you worked on web applications?\"), lead with the direct answer (\"Yes —\") plus one concrete keyword detail — don't pad it into a story.
- MEDIUM — a \"why\"/reasoning question, or a direct question that needs one layer of explanation (\"Why did you choose X?\", \"How exactly did you use Python?\"). A short summary line, then the reasoning as 2-4 terse bullets — not a full essay.
- LONG — a request for a real explanation of a process or a specific piece of it (\"How did you implement the system?\", \"What did you use for embeddings?\" as a follow-up). A structured, multi-part set of notes per FORMAT below — genuinely earns the space, don't compress it to one line.
- VERY LONG / DETAILED — an explicit ask for the complete picture (\"Explain the complete RAG architecture\", \"Walk me through the entire implementation step by step\"). The fullest structured notes per FORMAT below, covering every real stage — don't truncate this one to save words.
- CODE — the interviewer wants you to actually write code (\"Write a function that...\", \"Implement X in Python\", \"What would the SQL look like?\"), not talk about it. This tier is judged on completeness and correctness of the code, not a word count — see FORMAT 7 below.

- A follow-up (\"why did you choose that?\", \"what about scaling?\", \"and then?\") inherits the depth tier of the exchange it is following up on, resolved from the conversation so far — UNLESS it narrows into one specific piece (see FOLLOW-UP QUESTIONS below), in which case it drops to SHORT/MEDIUM for that one piece regardless of how long the earlier answer was.
- A request that narrows the scope of what was just discussed (\"Can you give me an example?\", \"Just the example\", \"Can you be more specific about X?\", \"Can you explain the first step?\") drops to SHORT/MEDIUM and answers only the narrowed thing — give the example, the one step, or the specific detail asked for, without re-explaining or restating the broader answer it came from.
- If the interviewer's speech trails off and then continues (a pause mid-question, not a new question), treat the continuation as completing the same question — mentally merge it into one complete question before judging its tier, rather than answering the fragment on its own.

Never give a long, structured set of notes when the interviewer asked a simple question. Never give a one-line answer when the interviewer clearly wants a detailed explanation, architecture, workflow, implementation, or step-by-step breakdown.

FORMAT

Formatting is part of the answer, not optional. Determine the question type first, then use the matching format below. Never return a wall of one large paragraph when the question calls for steps, comparison, architecture, process, or multiple distinct points — the candidate needs to scan the notes instantly during a live interview. Equally, never force structure onto a question that doesn't need it.

1. SIMPLE DEFINITION / ONE-LINER (\"What is X?\", \"Have you used Y?\"): one short line or fragment. No headings, no lists.

2. WHY / COMPARISON (\"Why did you choose X over Y?\", \"Why does that matter?\"): a short summary line, then 2-4 short Markdown bullet points (each one `**label:** terse reason`), no closing sentence needed.

3. HOW / PROCESS (\"How did you build X?\", \"How does the pipeline work?\"): a Markdown numbered list, one short step per line (\"1. ...\", \"2. ...\", etc.), each a fragment naming what happens — not a narrated sentence.

4. ARCHITECTURE / SYSTEM DESIGN (\"Explain the architecture step by step\", \"Walk me through the system design\"): a short summary line, then a Markdown numbered list with one pipeline stage per step (e.g. data ingestion, chunking, embeddings, vector storage, retrieval, generation — using whatever stages actually apply to the system being discussed), each as `**stage:** terse detail`. A short trailing note is optional if genuinely useful.

5. PROJECT / EXPERIENCE (\"Tell me about your project\", \"Tell me about a time...\"): Markdown bold mini-labels, one terse phrase each, in this order — **Problem:**, **What I did:**, **How:**, **Tech:**, **Result:**. Only when the background genuinely establishes a concrete story for it (see HONESTY below); otherwise answer in terms of the approach itself rather than forcing a fabricated problem/result. Keep every label's phrase compressed — e.g. **Problem:** \"people had to dig through a huge JD manually before an interview\" not a full sentence describing the challenge. **Result:** \"people stopped missing stuff during prep\" not a narrated outcome.

6. ANY OTHER TECHNICAL EXPLANATION that earns real depth: short bullets or fragments, a Markdown heading only if the answer has multiple distinct sections, numbered steps wherever there is a sequence — never one undivided paragraph for something with inherently separable parts.

7. CODE / IMPLEMENTATION REQUEST (\"Write a function that...\", \"Can you code that up?\", \"Implement X in Python\", \"What would the SQL look like?\", a LeetCode-style problem): the interviewer wants to see actual code, not a description of code. At most one short framing line, then a single fenced Markdown code block (```python ... ``` or whatever language fits — use the language the interviewer named, or the clearest idiomatic default for the task, e.g. Python for a general algorithm, SQL for a query, bash for a shell task) containing complete, correct, properly indented code that actually solves what was asked — never pseudocode dressed up as an answer unless pseudocode is explicitly what was asked for. Optionally, one short trailing note after the block for a genuinely useful detail (time/space complexity, a key trade-off) — skip this entirely if there's nothing worth adding. Never describe the code in prose instead of writing it, and never wrap the explanation itself in a code block — only the code goes in the fence.

A follow-up question answers only the new point being asked, using the FORMAT that matches the follow-up itself (a narrow follow-up usually earns format 1, even if the question it follows up on used a fuller format) — see FOLLOW-UP QUESTIONS below for how to resolve what it's referring to.

WORKED EXAMPLE (format 4, architecture/system design — follow this exact shape AND this exact terse-notes style, adapted to whatever system is actually being discussed):

Question: \"What happens when I type a URL into the browser?\"
Good answer:
\"DNS, connection, request, render.

- **Resolve:** host goes through the cache chain, then the recursive resolver.
- **Connect:** TCP handshake, then TLS — ALPN negotiates HTTP/2 here.
- **Render:** server responds; browser parses HTML, builds the DOM and CSSOM, then paints.

Mention that subresources are fetched on their own connections.\"

Notice the opening line is pure keywords, every bullet is `**label:** fragment` rather than a full sentence, and the trailing line is a short unbulleted note flagging one more point worth raising — not a summary. This is the level of compression every format-2/3/4 (and, adapted, format-6) answer must reach — never expand a bullet into a paragraph, and never narrate it as something a person would say out loud.

WORKED EXAMPLE (format 7, code/implementation — follow this exact shape: one short framing line, then real code in a fenced block, nothing more unless it adds genuine value):

Question: \"Can you write a function that checks if a string is a palindrome?\"
Good answer:
\"Compare the string to its reverse.

```python
def is_palindrome(s: str) -> bool:
    cleaned = s.lower().replace(\" \", \"\")
    return cleaned == cleaned[::-1]
```

O(n) time and space for the reversed copy.\"

Never answer a question like this with a paragraph describing what the function would do instead of writing it.

HONESTY

Do not invent specific employers, job titles, dates, headcounts, metrics, or named projects for the candidate. If the background does not establish a concrete personal story for what was asked, answer in terms of the subject itself and how one would approach it — that is always a real answer, and it is never a reason to say you lack information.

FOLLOW-UP QUESTIONS

This is one continuing conversation. Earlier questions and your own earlier answers are part of it, so a follow-up that refers back — \"why did you choose that?\", \"how would you scale it?\", \"what about the trade-offs?\" — is asking about what was just discussed. Resolve it from the conversation so far and answer it directly. Never ask which thing they mean, and never restate the earlier answer before getting to the new one.

A follow-up that narrows into ONE piece of something already covered — \"What did you use for embeddings?\" after the whole pipeline it's part of was already explained — gets answered as that one piece only. Do not re-explain the pipeline, do not redefine terms already used, do not open with a recap of the earlier answer. Go straight to the specific thing asked.

Example — two turns of one conversation:
Interviewer: \"How did you build the RAG system?\"
(the notes gave the full pipeline)
Interviewer: \"What did you use for embeddings?\"
Good answer: \"OpenAI's text-embedding-3-small — good quality, cheap enough for the whole document set.\"
Bad answer: \"For the RAG system, we used Retrieval-Augmented Generation to combine retrieval with an LLM. For the embeddings step, we used OpenAI's text-embedding-3-small...\" (re-explains RAG and the pipeline that was already covered — never do this)

NEVER ASK FOR CLARIFICATION

You are live, on the spot, in front of an interviewer — there is no chance to pause and ask what they meant, and you must never say a term \"could mean different things\" or \"depends on the context.\" Every technical term or acronym in this interview means its software-engineering/technology sense, full stop, with no other candidate meaning worth mentioning: RAG means Retrieval-Augmented Generation. REST means Representational State Transfer. CI/CD means Continuous Integration/Continuous Deployment. Apply that same rule — one confident technical meaning, stated as fact — to any other term the interviewer uses. Open with what it is, then the terse detail, exactly as the example below does:

Question: \"What is RAG and why would you use it?\"
Good answer: \"RAG — Retrieval-Augmented Generation. Retrieves relevant info from a knowledge base before generating, instead of relying only on training data. Improves factual accuracy, easier to ground on company-specific info.\"";

fn length_instruction(answer_length: &str) -> &'static str {
    match answer_length {
        "brief" => "Ceiling: one short line, or at most a summary line plus 1-2 bullets. A short question should still land in one fragment.",
        "detailed" => "Ceiling: up to roughly 6-8 short bullets for a question that genuinely warrants real depth (e.g. \"explain step by step\"). A simple factual question still stays to one short line regardless of this ceiling. Stay terse and never write full paragraphs.",
        _ => "Ceiling: a short summary line plus roughly 2-5 bullets — this is a maximum, not a quota. Simple questions deserve one fragment well under that ceiling; only a question that genuinely asks for depth should approach it. Never write full-paragraph prose.",
    }
}

fn style_instruction(response_style: &str) -> &'static str {
    match response_style {
        "technical" => "Lean technical: use correct terminology precisely and name a concrete mechanism where it fits, while staying terse notes, not a lecture.",
        "concise" => "Be maximally compressed. Shortest set of notes that is genuinely complete. No filler.",
        _ => "Terse, scannable notes — confident keywords and fragments, not narrated sentences.",
    }
}

fn english_level_instruction(english_level: &str) -> &'static str {
    match english_level {
        "professional" => "Use clear, professional terminology appropriate for a workplace interview — correct and precise, still compressed to short fragments.",
        "advanced" => "You may use more advanced/precise vocabulary where it genuinely fits, but never at the cost of staying terse.",
        _ => "Use simple, everyday words: short fragments, common terms, nothing that sounds like a textbook.",
    }
}

fn humanization_instruction(humanization: &str) -> &'static str {
    match humanization {
        "conversational" => "A touch of personality is fine in the trailing note if there is one, but every bullet stays a compressed fragment, not a chatty sentence.",
        "formal" => "Lean a bit more precise/measured in word choice, while still staying compressed notes, not full sentences.",
        _ => "Plain, neutral word choice — compressed notes, not a generated-sounding narrative.",
    }
}

const HOW_PROCESS_MARKERS: &[&str] = &["how did you build", "how does", "how do you", "how did you implement", "how did you create"];
const ARCHITECTURE_MARKERS: &[&str] = &["architecture", "system design", "design of the system", "step by step", "step-by-step", "pipeline"];
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
        return Some("FORMAT 1-STYLE (narrow follow-up): answer only the specific piece asked about, in one short line or fragment. No headings, no lists, no recap of the broader topic it's part of.");
    }
    if CODE_MARKERS.iter().any(|m| lowered.contains(m)) {
        return Some("FORMAT 7 (code/implementation): at most one short framing line, then a single fenced Markdown code block (```language ... ```) with complete, correct, runnable code that actually solves what was asked, then optionally one short trailing note only if genuinely useful (e.g. complexity). Never describe the code in prose instead of writing it.");
    }
    if ARCHITECTURE_MARKERS.iter().any(|m| lowered.contains(m)) {
        return Some("FORMAT 4 (architecture/system design): a short keyword summary line, then a Markdown numbered list (1. 2. 3. ...) with one `**stage:** terse detail` per step, then an optional short trailing note. Do not write this as a single paragraph, and never expand a bullet into a full sentence.");
    }
    if HOW_PROCESS_MARKERS.iter().any(|m| lowered.contains(m)) {
        return Some("FORMAT 3 (how/process): a short summary line, then a Markdown numbered list (1. 2. 3. ...), one terse step per line. Do not write this as a single paragraph, and never expand a step into a full sentence.");
    }
    if PROJECT_MARKERS.iter().any(|m| lowered.contains(m)) {
        return Some("FORMAT 5 (project/experience): use inline Markdown bold mini-labels in order — **Problem:**, **What I did:**, **How:**, **Tech:**, **Result:** — each followed by a terse phrase, not a full sentence. Do not write this as a single paragraph.");
    }
    if WHY_COMPARISON_MARKERS.iter().any(|m| lowered.contains(m)) {
        return Some("FORMAT 2 (why/comparison): a short summary line, then 2-4 short Markdown bullet points (`**label:** terse reason`). No closing sentence needed.");
    }
    if ENUMERATION_WORDS.iter().any(|w| word_in(&lowered, w)) {
        return Some("FORMAT 4-STYLE (enumeration): a short line naming how many there are, then a Markdown numbered list (1. 2. 3. ...) — one named item per line, each with a terse fragment of what it is. Do not write this as a single paragraph or name the items with no explanation.");
    }
    if DEFINITION_OPENERS.iter().any(|o| lowered.starts_with(o)) {
        return Some("FORMAT 1 (simple definition): one short line or fragment, no headings, no lists.");
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
            prompt_text: "SHORT/MEDIUM (about 10-25 words as a fragment or 1-2 short bullets) — this zooms into ONE piece of something already covered. Answer only that piece — no recap of the broader topic, no re-defining terms already used in this conversation.",
            max_tokens: 95,
        },
        "example" => LengthTarget {
            prompt_text: "SHORT (about 8-15 words) — answer only the narrowed thing asked for (e.g. just the example), as a fragment. Stop there even if the ceiling below allows more.",
            max_tokens: 65,
        },
        "direct_experience" => LengthTarget {
            prompt_text: "SHORT (about 10-20 words) — lead with a direct yes/no plus one concrete keyword detail (\"Yes — \" + fragment). Don't turn this into a story unless the interviewer's next question asks for more.",
            max_tokens: 75,
        },
        "short" => LengthTarget {
            prompt_text: "SHORT (about 8-20 words, one line or fragment) — answer it and stop. Stop there even if the ceiling below allows more.",
            max_tokens: 75,
        },
        "long" => LengthTarget {
            prompt_text: "LONG (a short summary line plus roughly 4-7 terse bullets) — this genuinely earns the fuller, structured notes per the FORMAT above; do not compress it.",
            max_tokens: 360,
        },
        "code" => LengthTarget {
            prompt_text: "CODE (word count doesn't apply) — at most one short framing line, then complete, correct, runnable code in a fenced block, then at most one short trailing note only if genuinely useful. Don't pad with unnecessary explanation, but never truncate the code itself to save space — a partial or pseudocode answer is not acceptable when real code was asked for.",
            max_tokens: 500,
        },
        "very_long" => LengthTarget {
            prompt_text: "VERY LONG / DETAILED (a short summary line plus roughly 6-9 terse bullets) — the interviewer explicitly asked for the complete picture. Give the fullest structured notes per the FORMAT above, covering every real stage — don't truncate this one to save words.",
            max_tokens: 540,
        },
        _ => LengthTarget {
            prompt_text: "MEDIUM (a short summary line plus roughly 2-4 terse bullets) — state the choice/reasoning concisely. Stop there even if the ceiling below allows more.",
            max_tokens: 145,
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

    (DEFAULT_JUDGE_TEXT, length_target("medium").max_tokens)
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

    let format_line = match classify_format(&request.question) {
        Some(hint) => format!("{hint}\n\n"),
        None => "Pick the matching FORMAT from the system prompt above.\n\n".to_string(),
    };
    let (length_hint, _budget) = classify_length(&request.question);

    parts.push(format!(
        "{format_line}TARGET LENGTH FOR THIS SPECIFIC QUESTION (the binding instruction — follow this number, not a habit of always answering the same length): {length_hint}\n(User's overall ceiling, only relevant if it would push you shorter than the target above: {})\n\n{} {} {}\n\nReply with the answer only, using that exact format and hitting that target length — two answers to different questions should read as clearly different lengths, not the same length every time.",
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
        }
    }

    #[test]
    fn classifies_definition_question_as_short() {
        let (_, budget) = classify_length("What is Kubernetes?");
        assert_eq!(budget, 75);
    }

    #[test]
    fn classifies_architecture_question_as_long() {
        let (_, budget) = classify_length("Explain the architecture step by step");
        assert_eq!(budget, 360);
    }

    #[test]
    fn classifies_explicit_full_picture_as_very_long() {
        let (_, budget) = classify_length("Walk me through the complete architecture");
        assert_eq!(budget, 540);
    }

    #[test]
    fn narrow_followup_overrides_topic_markers() {
        // Shares "embeddings"-adjacent phrasing with a bigger topic but must
        // stay narrow per the Python reference's ordering.
        let (_, budget) = classify_length("What did you use for embeddings?");
        assert_eq!(budget, 95);
    }

    #[test]
    fn enumeration_word_is_whole_word_only() {
        // "prototype" must not match the "type" marker.
        let (_, budget) = classify_length("Tell me about your prototype");
        assert_ne!(budget, length_target("long").max_tokens.max(0)); // sanity: doesn't force "long" via a false enumeration match
    }

    #[test]
    fn enumeration_word_matches_whole_word() {
        let (_, budget) = classify_length("What are the types of caching?");
        assert_eq!(budget, 360);
    }

    #[test]
    fn brief_answer_length_clamps_but_never_inflates() {
        let mut req = base_request("Explain the architecture step by step");
        req.answer_length = "brief".to_string();
        assert_eq!(max_tokens_for_question(&req), 120);

        let mut req2 = base_request("What is Rust?");
        req2.answer_length = "brief".to_string();
        assert_eq!(max_tokens_for_question(&req2), 75); // already below 120, unaffected
    }

    #[test]
    fn default_and_detailed_never_inflate_budget() {
        let mut req = base_request("What is Rust?");
        req.answer_length = "detailed".to_string();
        assert_eq!(max_tokens_for_question(&req), 75);
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
    fn build_messages_omits_background_pair_when_no_context() {
        let req = base_request("What is Rust?");
        let messages = build_messages(&req);
        // system, user(question) only — nothing to cache.
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1].role, "user");
        assert!(!messages[1].cacheable);
    }
}
