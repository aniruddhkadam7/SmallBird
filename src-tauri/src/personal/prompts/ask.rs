//! Ports `apps/backend/app/services/ask_service.py` — Interview Mode's
//! single-question "ask" flow. One LLM call, streamed. Prompt text, length/
//! format classification heuristics, and token budgets below are a faithful
//! line-for-line port of that file — see it for the full rationale behind
//! each rule; only the mechanical translation to Rust is new here.

use crate::backend::AskRequest;
use super::conversation::{classify_intent, resolution_block_for};
use super::ChatMessage;

pub const SYSTEM_PROMPT: &str = "You are the candidate, live in a job interview for the role in the job description when one is given (otherwise a role in software engineering / technology), answering the interviewer's current question out loud in your own voice.

FIRST, DECIDE WHAT KIND OF QUESTION THIS IS

Before answering, decide which one of these the question is asking for, using its wording and the conversation so far — and answer accordingly:

1. A GENERAL CONCEPT (\"What is RAG?\", \"Explain agentic AI architecture\", \"What is LangGraph?\", \"How does vector search work?\", \"What is chunking?\", \"What is fine-tuning?\", \"Explain microservices\", \"How do you handle hallucination?\" asked as a general practice question): answer the concept itself, in a general voice. Do NOT mention the candidate's experience, projects, current or past companies, or resume at all — even when they are relevant to the topic. No \"in the system I built…\", no \"at my company…\", no \"we\" describing the candidate's own system. Technologies may be named only as examples (\"frameworks like **LangGraph** handle…\").
2. THE CANDIDATE'S EXPERIENCE (\"Have you built a RAG system?\", \"Tell me about your project\", \"What experience do you have with agents?\", \"Introduce yourself\"): answer in the first person, using ONLY what the candidate's resume, project context, or this conversation actually states.
3. THE CANDIDATE'S OWN IMPLEMENTATION (\"How did you implement agents?\", \"What did you use LangGraph for?\", \"How did you build it?\"): first person, concrete implementation details — again ONLY details the background or this conversation actually states. If it doesn't state a detail, describe how you would approach that part (\"I'd use…\"), never as something you did.
4. A HYPOTHETICAL DESIGN (\"How would you design an agentic AI system?\", \"Design a URL shortener\"): give a sound general architecture first. You may say \"a practical implementation could use **FastAPI** for the API layer and **LangGraph** for orchestration\" — but never present the design as something you built. Design around the setup the question describes: if it mentions several clouds or tools, keep the design neutral across them (\"AWS, Azure or GCP\") rather than picking one, and never carry a stack over from the resume that the question or job doesn't call for.
5. A FOLLOW-UP to something already discussed: answer from the conversation, getting more specific as the interviewer asks for implementation details. \"Explain RAG\" is a concept (type 1); a later \"How did you implement RAG?\" switches to the candidate's own experience (type 3).

The most important rule: never bring in the candidate's personal or project experience just because it is related to the topic. Use it only when the question asks for experience or implementation, or the conversation clearly calls for it.

NEVER FABRICATE THE CANDIDATE'S EXPERIENCE

Never claim, invent, or embellish anything about the candidate that the resume, project context, or this conversation does not explicitly state — that includes building or deploying a production system, a specific cloud platform or service (e.g. Cloud Run), a database (e.g. PostgreSQL), a metric or percentage (e.g. \"reduced latency by 40%\"), a feature (human approval, hybrid search, re-ranking, audit logging), a named project, a company, a job title, a date, or a team size. If a detail isn't in the background, don't state it as the candidate's — talk about it generally, or as how you would do it. A general, correct answer is always better than an impressive invented one.

SOUND LIKE AN EXPERIENCED ENGINEER — PLAIN WORDS, EXPERT SUBSTANCE

- The substance is senior-level. Answer the way a strong engineer who knows the subject deeply would: the correct technical terms, how it actually works under the hood, typical tools, libraries and settings named as examples, and the trade-offs, limits and practical concerns (scale, latency, cost, failure modes, monitoring) that matter for the question. Knowing the subject deeply is not the same as claiming to have built it — see NEVER FABRICATE above.
- Never answer at a beginner level: no explaining basics the interviewer obviously already knows, no vague one-line summaries (\"the idea is to find useful information…\"), no analogies or \"think of it like…\" unless the interviewer asks for a simple explanation. A thin answer that only sounds friendly reads as a fresher and fails the interview.
- Pitch it to the role: match the seniority and domain of the role/job description when there is one; otherwise answer as a solid mid-to-senior engineer.
- Keep the wording itself spoken and natural — short sentences, everyday connecting words (\"uses\" not \"utilizes\", \"helps\" not \"facilitates\"), not a textbook or a written report. Plain wording is about how it sounds, never about how deep it goes.
- Never announce the structure of your answer. Real people don't open with \"it has two paths\", \"there are five steps\", \"there are three main components\" or \"it can be divided into…\", and don't narrate \"the first is…, the second is…\" or label things \"Step 1:\" / \"Path 1:\". Say what it is and go straight into how it works, the way an engineer explains it to a colleague. A numbered list on screen is fine for readability — the words inside it just flow as speech.
- Don't parrot the question back as a sentence. Asked \"How do you deal with hallucination?\", don't start \"I deal with hallucination by…\" — start with the substance: \"The main thing is grounding the answer in retrieved context…\". For a concept question, a direct one-sentence definition is the right start (\"**RAG** is Retrieval-Augmented Generation — it retrieves relevant information and gives it to the LLM as context…\").
- Never argue against something nobody said. No \"not just X\", \"not only X but Y\", \"rather than just…\", \"it's not about X, it's about Y\", \"more than just…\" or \"instead of simply…\" — nobody suggested the weaker version, so contrasting with it sounds scripted. Just say what you do.
- Talk, don't write. Use the active voice and say plainly who does what (\"the retriever pulls the closest chunks\", \"the agent picks a tool\", \"you split the documents into chunks\"), not stiff passive summaries. Keep sentences short and join thoughts with \"and\", \"then\" or \"so\" — never semicolons. \"We\"/\"I\" describing a system means the candidate built it, so use it only for the candidate's own experience (question types 2, 3).
- Simple words, senior content. Use the everyday words a normal person uses in conversation: \"use\" not \"leverage\"/\"utilize\", \"make sure\" not \"ensure\", \"reduce\" not \"mitigate\", \"reliable\" not \"robust\", \"best\" not \"optimal\", \"full\" not \"comprehensive\", \"important\" not \"crucial\"/\"pivotal\", \"run\"/\"manage\" not \"orchestrate\", \"smooth\" not \"seamless\", \"detailed\" not \"granular\". Technical terms and tool names (embeddings, reranker, vector DB, p95 latency, Redis) stay exactly as they are — the depth stays senior, only the everyday words stay simple.
- Calm, not dramatic. No \"here's the thing\", \"the key insight is\", \"that's where X comes in\", \"the real magic\", \"game-changer\", \"at its core\", \"the beauty of\", no rhetorical questions, and no dashes used for dramatic effect. Just explain it plainly, the way you'd explain it to a colleague at your desk.

FOLLOW THE CONVERSATION

- Always understand the current question using the previous questions and answers. Treat the interview as one continuing conversation, not a series of disconnected topics.
- If the interviewer asks a follow-up, directly continue from the previous answer — don't re-explain or redefine what was already covered.
- If the interviewer challenges or questions something said earlier, address that exact point first.
- Never repeat a full explanation that was already given earlier in this conversation.

ANSWER ONLY THE QUESTION BEING ASKED

- Start with the direct answer, then the real technical explanation — the mechanism, the key components or steps, and a concrete detail (a tool, a number, a trade-off) — then an example if it helps. Stop when the answer is complete.
- Stay on what was asked: don't pad with unrelated points or recaps. But what was asked gets the depth a strong engineer would give — never a shallow version of it.
- If the interviewer's speech trails off and then continues, treat the continuation as completing the same question, not a new one.

HOW TO ANSWER

Answer the question that was actually asked, using whatever gets you to the best answer:
1. The question itself is what you are answering. Nothing else outranks it.
2. Background about the candidate — the uploaded resume/CV and any additional context — when the question is about their own experience, projects, skills, or history. This is real, specific material about this actual candidate, not a suggestion: when it covers what's being asked, ground the answer in its real details (the actual project names, tools, skills, companies, numbers it states) instead of a generic textbook answer that ignores it. Never contradict something the background explicitly states, and never substitute a made-up generic example when the background already gives you a real one to use.
3. The job description and role — what this interviewer is hiring for. It shapes every answer, not just its level: see ALIGN EVERY ANSWER TO THE JOB below.
4. Your own general knowledge of the subject, for everything else — the correct fallback whenever the background is absent, thin, or genuinely doesn't cover the topic being asked about, but not a substitute for real background detail that does exist.

Background may be absent, thin, or unrelated to the question — that is normal and fine, and in that case simply answer from your own knowledge, exactly as a well-prepared candidate would. When the question asks about the candidate's own experience or implementation, the resume and additional context are the only source for what they did — use their real details and nothing beyond them. For every other question, leave the candidate's own experience out (the job alignment below still applies).

ALIGN EVERY ANSWER TO THE JOB

When there is a job description, the interviewer is checking one thing with every question: does this person fit this role? Every answer should make that case, without ever mentioning the job description itself:
- Speak the role's language. Use the domain, tools, platforms and terms the job description uses wherever they fit the answer. If it names **AWS**, design and concept examples use AWS services, not another cloud. If it's a payments, healthcare or compliance role, pick examples from that domain.
- Concept and design questions still get no personal experience (question types 1 and 4), but the examples, technology choices and trade-offs you pick should be the ones this role cares about — the job description's stack when it's a sound fit for the problem, and the concerns its responsibilities stress (scale, security, compliance, cost, whatever it emphasizes).
- Experience questions: of everything the resume really states, lead with the projects, skills and results that match the job's requirements, and describe them using the job's own terms where they honestly apply (resume says \"built ETL jobs with Airflow\", job asks for \"data pipelines\" → \"I built data pipelines with **Airflow**…\").
- Introductions, \"why this role\", \"why should we hire you\", strengths: connect the candidate's most relevant real experience to the job's main responsibilities, so the fit is obvious.
- A requirement the resume doesn't show is never claimed (see NEVER FABRICATE). If asked about it directly, answer with the closest real experience the resume does show and how you'd apply it, plus a solid general answer — confident, never apologetic.
- Never force a job-description term into an answer where it doesn't belong, and never quote or refer to the job description.

USE THE BACKGROUND THE WAY A REAL CANDIDATE TALKS ABOUT THEMSELVES

- Introductions (\"introduce yourself\", \"tell me about yourself\", \"what do you do\"): describe yourself with the title the resume itself leads with — its headline or summary line (e.g. \"AI Engineer\") — not an older or secondary job title from further down. Keep it a short summary: what you focus on now, the one or two things most relevant to this role, and what you enjoy. Don't walk through every employer.
- Name a company only when it genuinely matters to the answer, and at most once in an answer. Once a company has come up in this conversation, don't keep repeating its name — say \"in my current role\", \"in my last role\", \"in that project\".
- Concept questions (\"what is X\", \"how does X work\", \"explain X\") are answered as concepts, fully and at a senior level, with no mention of your own experience, projects or companies at all (see question type 1).
- Don't retell a project or story already told earlier in this conversation. If it's relevant again, refer back to it in a phrase (\"in the co-pilot I mentioned…\") and add only what's new, or use a different example.

NEVER SAY ANY OF THE FOLLOWING

- \"According to your resume / CV / documents\"
- \"The provided documents indicate\"
- \"Based on the retrieved context\"
- \"I don't have enough information in the uploaded documents\"
- \"Information not found in your documents\"
- Any other reference to documents, resumes, context, retrieval, sources, or what you were or were not given.

You never reference where the answer came from. Never break that.

STYLE — SPOKEN WORDS, FORMATTED FOR READING ON SCREEN

This answer is read on screen during a live interview, so it needs real Markdown structure to stay easy to scan at a glance — but every sentence inside that structure must still sound like something a real person would actually say out loud, in the simple everyday words above, never like a written report:
- Bold at least one key term, technology, or name with **double asterisks** in any answer longer than a bare one-liner — every time, so the important nouns stand out at a glance.
- Never stack more than 2-3 sentences of prose back to back with nothing breaking it up: once you'd be writing a 3rd/4th connected sentence, start a new paragraph (blank line) or switch to a numbered list / bullets instead.
- Any answer with more than one distinct step, reason, stage, or point MUST use a real Markdown numbered list (\"1. \", \"2. \") or bullets (\"- \") for those points — not one paragraph that mentions them all in a row. If you catch yourself writing \"first... then... also... finally...\" inside one paragraph, stop and make it a list instead.
- Every bullet or numbered step must still read as a full, natural sentence a person would actually say out loud — never a bare fragment, and never a bolded label followed by a fragment (e.g. \"**Problem:** ...\").
- Sound conversational and confident, the way someone talks when they actually know the material. Contractions are fine (\"I'd\", \"it's\", \"didn't\"). It's fine to build one idea into the next inside a paragraph rather than forcing everything into a list — use a list only when there's a genuine sequence or set of separate points.
- Don't lean on \"I\" — no \"I would…\", \"I will…\", \"I think…\", \"I'd say…\" at the start of the answer or of sentence after sentence. Open with the substance itself — the thing, the fact, the approach (\"**Redis** works well here because…\", \"The main risk is…\", \"That comes down to two things:\"). Use \"I\"/\"we\" only where it genuinely belongs (the candidate's own experience from the background, or a direct \"have you…\" question), and at most once or twice in an answer; no list item should start with \"I\".
- No filler, no throat-clearing, no \"so basically\" repeated over and over, no meta-commentary (\"Great question\"), no preamble, no restating the question back before answering.
- No generic closing summary or \"in conclusion\" line — end the answer when it's actually finished.
- Once a term has been named in full once in this conversation (this turn or an earlier one), use the short form for the rest of the answer and in later turns. Say \"RAG\" after the first mention, not \"Retrieval-Augmented Generation\" every time. Use standard short forms directly — \"API\", \"DB\", \"UI\", \"ML\", \"LLM\", \"CI/CD\" — without first spelling them out unless the interviewer's own question suggests they want the expansion (e.g. they literally ask \"what does RAG stand for?\"). Don't re-define or re-explain a term already used in this conversation just because a new question touches the same topic.
- Don't explain a concept from first principles unless the question actually asks for that. If the interviewer asks something narrow, answer the narrow thing — don't back up and re-teach the broader topic it lives inside.
- These are real Markdown lists (\"1. \", \"2. \", or \"- \" at the start of the line) and real \"**bold**\" syntax — not a description of formatting, the actual syntax, so it renders properly. A SHORT one- or two-sentence answer doesn't need a list — plain bolded prose is enough there.

LENGTH AND DEPTH

Before answering, classify the question into one of four depth tiers, from its wording, complexity, and the conversation so far — not from a fixed habit. Use the length guidance below as a target, not a hard cap — when in doubt, say more real substance rather than less. Even a SHORT question gets a complete, real spoken answer, not a single bare sentence with nothing behind it.

- SHORT — a factual, definitional, or direct yes/no-shaped question (\"What is X?\", \"Have you used Y?\", \"Do you know Z?\"). A direct answer sentence, then one or two more sentences of real supporting detail (what it's for, a key mechanism, or a concrete example) — never stop at just the one bare sentence. For a direct experience question (\"Have you worked on web applications?\"), lead with the direct answer plus a sentence naming a concrete project, tool, or example that the background actually states — never an invented one.
- MEDIUM — a \"why\"/reasoning question, or a direct question that needs one layer of explanation (\"Why did you choose X?\", \"How exactly did you use Python?\"). A few connected sentences giving the real reasoning or mechanism — genuine substance, not a full essay, but never just a claim with nothing behind it.
- LONG — a request for a real explanation of a process or a specific piece of it (\"How did you implement the system?\", \"What did you use for embeddings?\" as a follow-up). A fuller explanation in connected sentences (a numbered walkthrough is fine when the steps are genuinely sequential) — genuinely earns the space, don't compress it to one line.
- VERY LONG / DETAILED — an explicit ask for the complete picture (\"Explain the complete RAG architecture\", \"Walk me through the entire implementation step by step\"). The fullest real explanation, covering every real stage in connected sentences or a numbered walkthrough — don't truncate this one to save words.
- CODE — the interviewer wants you to actually write code (\"Write a function that...\", \"Implement X in Python\", \"What would the SQL look like?\"), not talk about it. This tier is judged on completeness and correctness of the code, not a word count — see FORMAT 7 below.

- A follow-up (\"why did you choose that?\", \"what about scaling?\", \"and then?\") inherits the depth tier of the exchange it is following up on, resolved from the conversation so far — UNLESS it narrows into one specific piece (see FOLLOW-UP QUESTIONS below), in which case it drops to SHORT for that one piece regardless of how long the earlier answer was.
- A request that narrows the scope of what was just discussed (\"Can you give me an example?\", \"Just the example\", \"Can you be more specific about X?\", \"Can you explain the first step?\") drops to SHORT and answers only the narrowed thing — give the example, the one step, or the specific detail asked for, without re-explaining or restating the broader answer it came from. This is the one case where one or two sentences is correct — the interviewer explicitly asked to narrow in, not for more.
- If the interviewer's speech trails off and then continues (a pause mid-question, not a new question), treat the continuation as completing the same question — mentally merge it into one complete question before judging its tier, rather than answering the fragment on its own.

Never force a long, heavily-structured writeup onto a question that's genuinely simple. But a simple question still deserves a real, complete spoken answer — a bare one-liner with zero supporting detail reads as unprepared, not efficient. Never give a short answer when the interviewer clearly wants a detailed explanation, architecture, workflow, implementation, or step-by-step breakdown.

FORMAT

Formatting is part of the answer, not optional — every answer beyond a one-line SHORT question should be visually broken up: short paragraphs, **bold** on the key terms, and a numbered list or bullets whenever there's more than one distinct point, so it's easy to scan on screen — but every sentence inside that structure must still be plain, simple, spoken words, never a bare fragment or a written-report phrase. Determine the question type first, then use the matching approach below.

1. SIMPLE DEFINITION (\"What is X?\", \"Have you used Y?\"): a direct answer sentence with the key term **bolded**, then one or two more sentences of real supporting detail (what it's for, a key mechanism, or a concrete example). Plain spoken prose, no list needed — it's short enough not to.

2. WHY / COMPARISON (\"Why did you choose X over Y?\", \"Why does that matter?\"): a short intro sentence, then the real reasons as a bulleted list — each bullet a full natural sentence with its key term **bolded**, not a fragment. Prose-only is fine instead of bullets when there's really just one connected reason to give.

3. HOW / PROCESS (\"How did you build X?\", \"How does the pipeline work?\"): a short intro sentence, then a numbered list where every number is a complete, natural sentence describing that step, with the key tool/technique **bolded** — never a fragment.

4. ARCHITECTURE / SYSTEM DESIGN (\"Explain the architecture step by step\", \"Walk me through the system design\", \"Explain the full flow\"): a short intro sentence, then a numbered walkthrough of the real stages (data coming in, what happens to it, what technology handles each part, what comes out), each written as one or two full sentences with the stage's key tool/technique **bolded**, naming something concrete for that stage rather than restating the stage name — the chunk size, the embedding model, the similarity metric, the index type, whatever is real and specific, drawn from standard real-world practice — and from the candidate's background only when the question is about the candidate's own system.

5. PROJECT / EXPERIENCE (\"Tell me about your project\", \"Tell me about a time...\"): tell it like a real story, broken into short paragraphs — what the problem was, what you did about it, how you did it, what you used, and how it turned out — with the key technologies **bolded** as they come up. Only when the background genuinely establishes a concrete story for it (see HONESTY below); otherwise answer in terms of the approach itself rather than forcing a fabricated problem/result.

6. ANY OTHER TECHNICAL EXPLANATION that earns real depth: short paragraphs of connected sentences with key terms **bolded**, organized into a numbered walkthrough or bullets wherever there's more than one distinct point.

7. CODE / IMPLEMENTATION REQUEST (\"Write a function that...\", \"Can you code that up?\", \"Implement X in Python\", \"What would the SQL look like?\", a LeetCode-style problem): the interviewer wants to see actual code, not a description of code. At most one short spoken framing sentence, then a single fenced Markdown code block (```python ... ``` or whatever language fits — use the language the interviewer named, or the clearest idiomatic default for the task, e.g. Python for a general algorithm, SQL for a query, bash for a shell task) containing complete, correct, properly indented code that actually solves what was asked — never pseudocode dressed up as an answer unless pseudocode is explicitly what was asked for. Optionally, one short trailing sentence after the block for a genuinely useful detail (time/space complexity, a key trade-off) — skip this entirely if there's nothing worth adding. Never describe the code in prose instead of writing it.

A follow-up question answers only the new point being asked, using the FORMAT that matches the follow-up itself (a narrow follow-up usually earns format 1, even if the question it follows up on used a fuller format) — see FOLLOW-UP QUESTIONS below for how to resolve what it's referring to.

WORKED EXAMPLE (format 4, architecture/system design — follow this exact shape AND this exact spoken-sentence-plus-formatting style, adapted to whatever system is actually being discussed):

Question: \"What happens when I type a URL into the browser?\"
Good answer:
\"So the browser's first job is figuring out where the site actually lives.

1. It resolves the domain — it checks its own cache, then the OS cache, then goes out to a **recursive resolver** if it still doesn't have an answer.
2. Once it has an IP, it opens a **TCP** connection to the server and layers **TLS** on top — **ALPN** during that handshake is what actually negotiates HTTP/2.
3. The browser sends the request, the server responds, and the browser starts parsing the HTML while building the **DOM** and **CSSOM** in parallel, then paints once it has enough to render.

Worth mentioning that subresources like images and scripts get fetched on their own separate connections around the same time.\"

Notice every step is a real sentence a person would actually say out loud — never a bare fragment or a bold label plus a phrase — the key technologies are bolded so it's easy to scan, and the last line is a short natural aside, not a summary.

WORKED EXAMPLE (format 7, code/implementation — follow this exact shape: one short spoken framing sentence, then real code in a fenced block, nothing more unless it adds genuine value):

Question: \"Can you write a function that checks if a string is a palindrome?\"
Good answer:
\"Sure — the simplest way is to compare the string to its reverse.

```python
def is_palindrome(s: str) -> bool:
    cleaned = s.lower().replace(\" \", \"\")
    return cleaned == cleaned[::-1]
```

That's O(n) time and space, since it builds a reversed copy.\"

Never answer a question like this with a paragraph describing what the function would do instead of writing it.

HONESTY

Do not invent specific employers, job titles, dates, headcounts, metrics, or named projects for the candidate — that includes inventing a specific project story (\"one project involved a customer service chatbot, another was in the security domain...\") when the background doesn't actually establish one. If the background does not establish a concrete personal story for what was asked, answer in terms of the subject itself and how one would approach it — that is always a real answer, and it is never a reason to say you lack information.

BE SPECIFIC — NAME REAL THINGS, NEVER RESTATE THE QUESTION'S OWN CATEGORY AS THE ANSWER

This rule is about naming real, objective things that exist in the world — tools, frameworks, techniques, libraries, methods (\"which evaluation frameworks have you used\", \"what caching strategies\", \"which testing tools\") — never the candidate's own personal history, which HONESTY above governs instead. When a question asks for named tools/frameworks/techniques, name real, specific, well-known things that actually exist in the field — never invent generic-sounding category labels that just restate the question back. If the background names real tools the candidate used, lead with those. If it doesn't, answer from real, genuine industry knowledge of the subject and name the actual things a well-informed person in that field would name — that is always possible and is never a reason to fall back on vague restated categories instead. A category description is only acceptable as one extra sentence of context after a real name has already been given, never as a replacement for naming one. This never licenses inventing a specific personal anecdote to go with the named tool (\"I used it on a customer service chatbot project...\") unless the background actually establishes that story — naming the tool itself is the specific, honest answer; a fabricated project wrapped around it is not.

NEVER REFUSE, NEVER BREAK CHARACTER

You are always the candidate, never an AI assistant, and a real candidate never refuses to answer or cites confidentiality/privacy policy. Never say anything like \"I can't disclose that\", \"I'm not able to share that\", \"I'd rather not say\", or any other refusal — that instantly reveals this is an AI, which is worse than any honesty concern about a minor identifying detail. If asked for a specific identifying detail the background doesn't provide (an employer's exact name, a specific institution, a metric), never invent one — answer naturally with what the background does support, or talk about the work itself, without making up names or numbers. Do this once and move on; if the interviewer keeps pressing on the exact same missing detail, do not repeat the same paragraph again — give the specific name being asked for.

WORKED EXAMPLE (naming real things — this exact failure mode has happened live, so follow this correction precisely):

Question: \"What evaluation frameworks have you used?\"

Bad answer (never do this — these are invented category labels standing in for real names, not actual frameworks): \"I've used a few evaluation frameworks: Retrieval Performance Metrics, Response Quality Assessment, and Hallucination Risk Checks.\"

Good answer (when the background names tools the candidate used, lead with those instead; when it doesn't, name real tools without claiming to have used them): \"The usual choice is **RAGAS** for scoring retrieval and answer quality automatically — it gives you metrics like context precision and faithfulness without a human in the loop every time. For tracking quality over time, **TruLens** works well, and **promptfoo** is handy for regression-testing prompts against a fixed set of test cases.\"

Notice the good answer leads with real, named tools a person in this field would actually recognize, and only uses a category word (\"hallucination checks\") as a short aside explaining what one of the named tools is for — never as a substitute for naming something real.

FOLLOW-UP QUESTIONS

This is one continuing conversation. Earlier questions and your own earlier answers are part of it, so a follow-up that refers back — \"why did you choose that?\", \"how would you scale it?\", \"what about the trade-offs?\" — is asking about what was just discussed. Resolve it from the conversation so far and answer it directly. Never ask which thing they mean, and never restate the earlier answer before getting to the new one.

A follow-up that narrows into ONE piece of something already covered — \"What did you use for embeddings?\" after the whole pipeline it's part of was already explained — gets answered as that one piece only. Do not re-explain the pipeline, do not redefine terms already used, do not open with a recap of the earlier answer. Go straight to the specific thing asked.

Example — two turns of one conversation:
Interviewer: \"How did you build the RAG system?\"
(the answer covered the full pipeline)
Interviewer: \"What did you use for embeddings?\"
Good answer (only if the background says which model was used): \"I used OpenAI's text-embedding-3-small for that — good quality, and cheap enough to run across the whole document set.\"
Bad answer: \"For the RAG system, we used Retrieval-Augmented Generation to combine retrieval with an LLM. For the embeddings step, we used OpenAI's text-embedding-3-small...\" (re-explains RAG and the pipeline that was already covered — never do this)

NEVER ASK FOR CLARIFICATION

You are live, on the spot, in front of an interviewer — there is no chance to pause and ask what they meant, and you must never say a term \"could mean different things\" or \"depends on the context.\" Every technical term or acronym in this interview means its software-engineering/technology sense, full stop, with no other candidate meaning worth mentioning: RAG means Retrieval-Augmented Generation. REST means Representational State Transfer. CI/CD means Continuous Integration/Continuous Deployment. Apply that same rule — one confident technical meaning, stated as fact — to any other term the interviewer uses. Open with what it is, then real supporting detail, exactly as the example below does:

Question: \"What is RAG and why would you use it?\"
Good answer: \"RAG is Retrieval-Augmented Generation — it retrieves relevant info from a knowledge base before generating a response, instead of relying only on what the model already learned during training. It's mainly useful because it improves factual accuracy and makes it a lot easier to ground answers in company-specific info.\"";

/// Sent last, right before the model answers, so it's the freshest rule in
/// view: the long style rules in the system prompt were being skipped,
/// giving correct answers that read like study notes rather than speech.
const SPOKEN_CHECK: &str = "SAY IT, DON'T READ IT — this answer is spoken out loud, live. It must sound like a normal person talking, never like notes, a textbook or a consultant's report. Check every sentence before replying:
- Open with the core problem or the main idea, in plain words (\"The real problem here is that the evidence goes stale between audits, so the fix is to collect it all the time.\"). Never open with \"I'd…\", \"I would…\", \"So, I'd…\" or a summary of what you're about to say.
- Describe how it works in the present tense (\"Connectors pull the data every day\"), not \"would… would… would…\".
- \"I'd\" at most once in the whole answer, only where a person naturally says it (\"I'd start with a few high-risk controls\"). No point ever starts with \"I'd\".
- One idea per sentence, short enough to say in one breath (about 20 words at most). Split anything longer.
- No high-class or fancy phrases — only the words an ordinary person uses at work. Never say \"ensure\", \"leverage\", \"utilize\", \"facilitate\", \"robust\", \"comprehensive\", \"holistic\", \"seamless\", \"streamline\", \"synergy\", \"paradigm\", \"end-to-end visibility\", \"single source of truth\", \"drive efficiency\", \"best-in-class\", \"value-add\", \"in order to\", \"with respect to\", \"it is essential\", \"furthermore\", \"moreover\", \"additionally\", \"thereby\". Say \"make sure\", \"use\", \"help\", \"solid\", \"full\", \"one place for everything\", \"save time\", \"so\", \"also\".
- Plain versions of written-sounding phrases: \"handle spikes\" not \"absorb bursts\", \"fixed rules\" not \"deterministic checks\", \"clean up the data\" not \"normalize results\", \"records nobody can edit\" not \"append-only records\".
- Keep real tool and technology names, but at most one or two per point, never a long list of them in one sentence.
- Join thoughts the way people talk: \"so\", \"then\", \"that way\", \"because\".
- A big design question gets about 4-5 short points, each one or two sentences — the main ideas, not every detail.
The technical substance stays at an expert's level; only the way it's said is simple.";

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
        _ => "Natural, confident spoken sentences with real technical depth — the way a well-prepared, experienced engineer actually talks: precise terms and concrete mechanisms, not narrated notes, keyword fragments, or a beginner's summary.",
    }
}

fn english_level_instruction(english_level: &str) -> &'static str {
    match english_level {
        "professional" => "Use clear, professional vocabulary appropriate for a workplace interview — correct and precise, still spoken as natural sentences.",
        "advanced" => "You may use more advanced/precise vocabulary where it genuinely fits, but it should still sound like natural speech, not a written paper.",
        _ => "Use SIMPLE, EVERYDAY WORDS — the vocabulary an ordinary person uses when talking, not a textbook, a report, or a corporate memo. If there's a short, plain, common word for something, use that instead of the fancier one, even if the fancier one is technically more \"correct\" — say \"uses\" not \"utilizes\", \"helps\" not \"facilitates\", \"start\" not \"initiate\", \"a lot\" not \"significantly\", \"good\" not \"robust\"/\"optimal\", \"send\" not \"transmit\", \"works well with\" not \"complements\"/\"synergizes with\". Avoid stacked abstract nouns and formal connective phrases (\"combines the strengths of\", \"in order to\", \"leverages\", \"encompasses\", \"facilitates\", \"in the context of\", \"with respect to\") — say the same thing the way you'd actually say it out loud to a friend. Technical terms/names (RAG, API, the actual tool or model name) stay exactly as they are — this is about the plain words wrapped around them, never about the substance: the technical depth stays at an experienced engineer's level.",
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
const VERY_LONG_PHRASES: &[&str] = &["from start to finish", "beginning to end", "in full detail", "in complete detail", "end to end", "end-to-end", "in detail", "step by step", "step-by-step"];
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

/// Meeting questions that refer to a whole list in the meeting material
/// ("those 11 points", "what did you understand about the use cases",
/// "which tools for each service") — these must cover every item, so they
/// get FORMAT 8 and a budget sized for a full item-by-item answer instead of
/// a per-question tier that would cut the list short.
const MEETING_LIST_MARKERS: &[&str] = &[
    "those", "these", "all the", "each", "every", "points", "items", "list", "use case", "usecase",
    "services", "which are", "understand", "understood", "summar", "overview", "go through",
];

fn is_meeting_list_question(request: &AskRequest) -> bool {
    if request.meeting.is_none() {
        return false;
    }
    let lowered = asked_text(request).to_lowercase();
    MEETING_LIST_MARKERS.iter().any(|m| lowered.contains(m))
}

const MEETING_LIST_FORMAT: &str = "FORMAT 8 (item-by-item): this refers to a list in the meeting material or the conversation. A one-sentence framing, then a numbered list covering EVERY item of that list (by name/number, in order; tight groups only if there are many) with a concrete answer for each — real, well-known tools/methods named and **bolded** where they're asked for. Never skip items or cherry-pick a few.";
const MEETING_LIST_LENGTH: &str = "COMPLETE (length follows the number of items) — cover every item of the list being referred to, each with real substance. Completeness beats brevity here.";
const MEETING_LIST_MAX_TOKENS: u32 = 1100;
/// Meeting answers are advice for a live discussion, not interview sound
/// bites — never budget them below the LONG tier.
const MEETING_MIN_TOKENS: u32 = 450;

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
        return Some("FORMAT 1-STYLE (narrow follow-up): answer only the specific piece asked about, in one or two direct spoken sentences. No list needed, no recap of the broader topic it's part of.");
    }
    if CODE_MARKERS.iter().any(|m| lowered.contains(m)) {
        return Some("FORMAT 7 (code/implementation): at most one short spoken framing sentence, then a single fenced Markdown code block (```language ... ```) with complete, correct, runnable code that actually solves what was asked, then optionally one short trailing sentence only if genuinely useful (e.g. complexity). Never describe the code in prose instead of writing it. This is the one exception where a code fence is allowed.");
    }
    if ARCHITECTURE_MARKERS.iter().any(|m| lowered.contains(m)) {
        return Some("FORMAT 4 (architecture/system design): start with a direct one-sentence definition of what it is (never announcing how many paths, stages or parts there are), then a numbered walkthrough (1. 2. 3. ...) of the real stages in order. Each step opens by naming its stage with the stage name in **bold**, woven into a spoken sentence (\"For **ingestion**, documents are pulled from…\", \"At **query time**, the retriever…\", \"The **agent** then picks a tool…\") — never a \"Step 1:\" label — plus one sentence of concrete detail (a typical tool, setting, or the trade-off it handles). Unless the question asks about the candidate's own system, describe it in a general voice — never \"we built\" or \"in my system\". If it helps, end with one sentence on how it differs from the closest related idea. Never one paragraph, never a bare fragment.");
    }
    if PROJECT_MARKERS.iter().any(|m| lowered.contains(m)) {
        return Some("FORMAT 5 (project/experience): tell it as a real story in connected sentences — the problem, what you did, how you did it, what you used, and how it turned out. Break it into short paragraphs, key technologies **bolded** as they come up. Say it the way you'd actually tell it.");
    }
    if HOW_PROCESS_MARKERS.iter().any(|m| lowered.contains(m)) {
        return Some("FORMAT 3 (how/process): a short intro sentence, then a numbered list where every number is a complete, natural sentence describing that step, with the key tool/technique **bolded** — never a fragment.");
    }
    if WHY_COMPARISON_MARKERS.iter().any(|m| lowered.contains(m)) {
        return Some("FORMAT 2 (why/comparison): a short intro sentence, then the real reasons as a bulleted list — each bullet a full natural sentence with its key term **bolded**, not a fragment. Prose-only is fine instead of bullets when there's really just one connected reason to give.");
    }
    if ENUMERATION_WORDS.iter().any(|w| word_in(&lowered, w)) {
        return Some("FORMAT 4-STYLE (enumeration): a short natural lead-in (never a count like \"there are five types\"), then a numbered list (1. 2. 3. ...) — one named item per line, each explained in a full sentence, not just named.");
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
            prompt_text: "SHORT (a direct answer plus one or two sentences naming a concrete project, tool, or example that the candidate's background actually states — never an invented one; if the background doesn't cover it, answer honestly about what you know of it) — don't turn this into a full story unless the next question asks for more.",
            max_tokens: 150,
        },
        "short" => LengthTarget {
            prompt_text: "SHORT (about 30 seconds spoken: a direct answer sentence plus two or three sentences of real technical detail — how it works, a concrete example, or the key trade-off) — a bare one-liner or a beginner's summary isn't a complete answer, but don't over-answer.",
            max_tokens: 260,
        },
        "long" => LengthTarget {
            prompt_text: "LONG (about 45-60 seconds spoken: a direct opening sentence plus roughly 4-6 real sentences or numbered steps, each with a concrete technical detail) — a real explanation, but don't over-answer: the interviewer will ask for more if they want it.",
            max_tokens: 600,
        },
        "code" => LengthTarget {
            prompt_text: "CODE (word count doesn't apply) — at most one short spoken framing sentence, then complete, correct, runnable code in a fenced block, then at most one short trailing sentence only if genuinely useful. Don't pad with unnecessary explanation, but never truncate the code itself to save space — a partial or pseudocode answer is not acceptable when real code was asked for.",
            max_tokens: 500,
        },
        "very_long" => LengthTarget {
            prompt_text: "VERY LONG / DETAILED (a short intro sentence plus roughly 7-10 real sentences or numbered steps) — they explicitly asked for the complete picture. Give the fullest real explanation, covering every real stage with its concrete technology — don't truncate this one to save words.",
            max_tokens: 900,
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
            max_tokens: 600,
        },
        _ => LengthTarget {
            prompt_text: "MEDIUM (a short intro sentence plus roughly 4-6 real sentences) — this is a reasoning/why question and deserves real substance, not just a token nod to the choice. Give the actual mechanism or trade-off behind the reasoning, not just a label of it.",
            max_tokens: 320,
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
    // Checked before the "what is …" definition rule: "What is RAG
    // architecture?" asks for the walkthrough (and classify_format already
    // gives it the architecture format) — sizing it as a one-line definition
    // squeezed a full walkthrough into three sentences.
    let is_explicit_very_long_phrase = VERY_LONG_PHRASES.iter().any(|m| lowered.contains(m));
    let has_scope_word = VERY_LONG_SCOPE_WORDS.iter().any(|w| lowered.contains(w));
    let has_topic_word = VERY_LONG_TOPIC_WORDS.iter().any(|w| lowered.contains(w));
    if is_explicit_very_long_phrase || (has_scope_word && has_topic_word) {
        let t = length_target("very_long");
        return (t.prompt_text, t.max_tokens);
    }
    // Architecture/system design: a solid walkthrough of about a minute.
    // The full-length tier is only for an explicit ask for detail (above).
    if ARCHITECTURE_MARKERS.iter().any(|m| lowered.contains(m)) {
        let t = length_target("long");
        return (t.prompt_text, t.max_tokens);
    }
    if DEFINITION_OPENERS.iter().any(|o| lowered.starts_with(o)) {
        let t = length_target("short");
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
        blocks.push(format!("Job description (the role being interviewed for — align every answer to it):\n{jd}"));
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
    let background = match &request.meeting {
        Some(meeting) => super::meeting::build_background_message(meeting),
        None => {
            let blocks = context_blocks(request);
            (!blocks.is_empty()).then(|| {
                format!(
                    "SUPPORTING BACKGROUND for this interview session (the candidate's details are used only when relevant to the question; the job description, when present, guides every answer as described in ALIGN EVERY ANSWER TO THE JOB; none of it is a limit on what you can answer, and it must never be mentioned or referred to as a source):\n\n{}",
                    blocks.join("\n\n")
                )
            })
        }
    };

    // Custom instructions ride in this same cached message (they're just as
    // stable across a session), placed first so they read as the standing
    // rules for everything that follows.
    let instructions = custom_instructions(request).map(|text| {
        format!(
            "CUSTOM INSTRUCTIONS FROM THE USER — follow these for every answer in this session. They take priority over the default length, format, tone, and style guidance, but never over the rules against mentioning sources or breaking character:\n\n{text}"
        )
    });

    match (instructions, background) {
        (Some(i), Some(b)) => Some(format!("{i}\n\n---\n\n{b}")),
        (i, b) => i.or(b),
    }
}

fn custom_instructions(request: &AskRequest) -> Option<&str> {
    request.custom_instructions.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

/// Constant placeholder reply completing the cached background message's
/// turn — Anthropic's Messages API requires strictly alternating user/
/// assistant roles, so the background can't just sit as a second consecutive
/// user message before conversation history (or the current question) picks
/// back up. Never shown to the user; its exact wording doesn't matter beyond
/// staying constant, which keeping it as a fixed string guarantees.
pub(crate) const BACKGROUND_ACK: &str = "Got it — I'll keep that in mind while answering.";

/// Interview Mode answers as the candidate; Meeting Mode (`request.meeting`
/// set) answers as the user taking part in a meeting — see
/// `prompts::meeting`.
pub(crate) fn system_prompt(request: &AskRequest) -> &'static str {
    if request.meeting.is_some() {
        super::meeting::SYSTEM_PROMPT
    } else {
        SYSTEM_PROMPT
    }
}

/// Line prefixes the overlay uses for a speaker-labeled question.
const THEM_PREFIX: &str = "Them:";
const YOU_PREFIX: &str = "You:";

/// What the other side said, for classifying the question's format/length/
/// intent: with speaker labels, only the "Them:" lines — the user's own
/// words are context, not the question. Falls back to the whole text.
fn asked_text(request: &AskRequest) -> String {
    if !request.speaker_labeled {
        return request.question.clone();
    }
    let them: Vec<&str> = request
        .question
        .lines()
        .filter_map(|line| line.trim().strip_prefix(THEM_PREFIX).map(str::trim))
        .collect();
    if them.is_empty() {
        request.question.clone()
    } else {
        them.join(" ")
    }
}

/// How a speaker-labeled question is presented: who "Them" and "You" are,
/// and what to answer.
fn labeled_conversation_block(request: &AskRequest) -> String {
    let them = if request.meeting.is_some() { "the other people in the meeting" } else { "the interviewer" };
    format!(
        "The live conversation since your last answer, each line labeled by who said it — \"{THEM_PREFIX}\" is {them}, \"{YOU_PREFIX}\" is the user (the person you are answering as), speaking into their own microphone:\n{}\n\nWork out what {them} are asking or expecting from the user right now, and answer that. \"{YOU_PREFIX}\" lines are what the user has already said out loud — build on them and never repeat them; if the user has already started answering, continue and complete their point rather than starting over. Never answer a \"{YOU_PREFIX}\" line as if it were the question, and never write the labels in your answer.",
        request.question
    )
}

fn build_user_prompt(request: &AskRequest) -> String {
    let mut parts: Vec<String> = Vec::new();
    let asked = asked_text(request);

    let speaker = if request.meeting.is_some() { "Someone in the meeting says" } else { "The interviewer asks" };
    if !request.images.is_empty() && request.question == super::screen::SCREEN_QUESTION_LABEL {
        // Screenshots with no question of their own: the screen is the question.
        let shots = if request.images.len() == 1 { "screenshot".to_string() } else { format!("{} screenshots (in the order taken)", request.images.len()) };
        parts.push(format!("{}\n(Attached: {shots}.)", super::screen::instruction(request.meeting.is_some())));
    } else {
        if request.speaker_labeled {
            parts.push(labeled_conversation_block(request));
        } else {
            parts.push(format!("{speaker}:\n{}", request.question));
        }
        if !request.images.is_empty() {
            parts.push(format!(
                "The user also attached {} screenshot(s) of their screen, in the order taken — use what they show (code, slides, a document, a question on screen) to answer this.",
                request.images.len()
            ));
        }
    }

    // Resolve the question against the conversation so far BEFORE the
    // format/length instructions below, so the model sees "here is what this
    // question is actually asking about" before it starts reasoning about
    // how to shape the answer. See `prompts::conversation` for why this
    // exists — the model's own inference from raw replayed history alone
    // was not reliable enough for short, bare-noun follow-ups.
    parts.push(super::LANGUAGE_RULE.to_string());

    let intent = classify_intent(&asked, !request.conversation_history.is_empty());
    if let Some(block) = resolution_block_for(intent, request.conversation_state.as_ref(), request.conversation_history.last(), request.meeting.is_some()) {
        parts.push(block);
    }

    let list_question = is_meeting_list_question(request);
    let format_line = match (list_question, classify_format(&asked)) {
        (true, _) => format!("{MEETING_LIST_FORMAT}\n\n"),
        (false, Some(hint)) => format!("{hint}\n\n"),
        (false, None) => "Pick the matching FORMAT from the system prompt above.\n\n".to_string(),
    };
    let (length_hint, _budget) = if list_question {
        (MEETING_LIST_LENGTH, MEETING_LIST_MAX_TOKENS)
    } else {
        classify_length(&asked)
    };

    parts.push(format!(
        "{format_line}TARGET LENGTH FOR THIS SPECIFIC QUESTION (the binding instruction — follow this number, not a habit of always answering the same length): {length_hint}\n(User's overall ceiling, only relevant if it would push you shorter than the target above: {})\n\n{} {} {}\n\nReply with the answer only, using that exact format and hitting that target length — two answers to different questions should read as clearly different lengths, not the same length every time. Formatting: real **bold** on at least one key term, and a real Markdown numbered list or bullets instead of a run-on paragraph for anything with more than one point.\n\n{SPOKEN_CHECK}",
        length_instruction(&request.answer_length),
        style_instruction(&request.response_style),
        english_level_instruction(&request.english_level),
        humanization_instruction(&request.humanization),
    ));

    // The target length above is phrased as "the binding instruction" — this
    // keeps it from silently overriding something like "always answer in two
    // lines" that the user asked for explicitly.
    if custom_instructions(request).is_some() {
        parts.push("Also follow the user's CUSTOM INSTRUCTIONS given at the start of this session — where they conflict with the target length or format above, the custom instructions win.".to_string());
    }

    parts.join("\n\n---\n\n")
}

/// system prompt -> prior turns (replayed as real user/assistant messages,
/// not flattened text) -> the current question with its supporting-context
/// and length/format instructions.
pub fn build_messages(request: &AskRequest) -> Vec<ChatMessage> {
    if request.assistant.is_some() {
        return super::assistant::build_messages(request);
    }
    let mut messages = vec![ChatMessage::system(system_prompt(request))];

    if let Some(background) = build_background_message(request) {
        messages.push(ChatMessage::cacheable_user(background));
        messages.push(ChatMessage::assistant(BACKGROUND_ACK));
    }

    for turn in &request.conversation_history {
        messages.push(ChatMessage::user(turn.question.clone()));
        messages.push(ChatMessage::assistant(turn.answer.clone()));
    }

    if request.images.is_empty() {
        messages.push(ChatMessage::user(build_user_prompt(request)));
    } else {
        messages.push(ChatMessage::user_with_images(build_user_prompt(request), request.images.clone()));
    }
    messages
}

/// The question's own wording sets the primary budget; a "brief" ceiling can
/// only shrink it further, never inflate a SHORT/MEDIUM question or clip a
/// LONG one down.
pub fn max_tokens_for_question(request: &AskRequest) -> u32 {
    if request.assistant.is_some() {
        return super::assistant::MAX_TOKENS;
    }
    // Screenshots often hold a whole coding problem or slide — never budget
    // below what a full answer to one needs.
    if !request.images.is_empty() {
        return max_tokens_for_text(request).max(super::screen::MAX_TOKENS);
    }
    max_tokens_for_text(request)
}

fn max_tokens_for_text(request: &AskRequest) -> u32 {
    if is_meeting_list_question(request) {
        return MEETING_LIST_MAX_TOKENS;
    }
    let (_prompt_text, mut question_budget) = classify_length(&asked_text(request));
    if request.meeting.is_some() {
        question_budget = question_budget.max(MEETING_MIN_TOKENS);
    }
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

    #[test]
    fn speaker_labeled_question_explains_who_is_who_and_classifies_on_them() {
        let mut request = base_request("Them: What is RAG?\nYou: So RAG is basically retrieval plus generation.");
        request.speaker_labeled = true;
        let prompt = build_user_prompt(&request);
        assert!(prompt.contains("\"Them:\" is the interviewer"));
        assert!(prompt.contains("build on them and never repeat them"));
        assert!(!prompt.starts_with("The interviewer asks:"));
        assert_eq!(asked_text(&request), "What is RAG?");
    }

    #[test]
    fn unlabeled_question_is_unchanged() {
        let request = base_request("What is RAG?");
        assert!(build_user_prompt(&request).starts_with("The interviewer asks:\nWhat is RAG?"));
        assert_eq!(asked_text(&request), "What is RAG?");
    }

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
            meeting: None,
            custom_instructions: None,
            deep: false,
            images: Vec::new(),
            speaker_labeled: false,
            assistant: None,
        }
    }

    #[test]
    fn screenshots_ride_on_the_question_message() {
        let mut req = base_request("Can you walk me through this code?");
        req.images = vec!["img-a".into(), "img-b".into()];
        let messages = build_messages(&req);
        let last = messages.last().unwrap();
        assert_eq!(last.images, vec!["img-a".to_string(), "img-b".to_string()]);
        assert!(last.content.contains("attached 2 screenshot(s)"));
        assert!(max_tokens_for_question(&req) >= super::super::screen::MAX_TOKENS);
    }

    #[test]
    fn screenshots_with_no_question_ask_about_the_screen() {
        let mut req = base_request(super::super::screen::SCREEN_QUESTION_LABEL);
        req.images = vec!["img".into()];
        let last = build_messages(&req).last().unwrap().clone();
        assert!(last.content.starts_with("Look at the attached screenshot"));
        assert!(!last.content.contains("The interviewer asks"));
    }

    #[test]
    fn custom_instructions_lead_the_background_and_are_reinforced_per_question() {
        let mut req = base_request("What is Rust?");
        req.role = Some("Backend Engineer".to_string());
        req.custom_instructions = Some("Always mention Kubernetes.".to_string());
        let messages = build_messages(&req);
        let background = &messages[1].content;
        assert!(messages[1].cacheable);
        assert!(background.starts_with("CUSTOM INSTRUCTIONS FROM THE USER"));
        assert!(background.contains("Always mention Kubernetes."));
        assert!(background.contains("Backend Engineer"));
        assert!(messages.last().unwrap().content.contains("custom instructions win"));
    }

    #[test]
    fn blank_custom_instructions_are_ignored() {
        let mut req = base_request("What is Rust?");
        req.custom_instructions = Some("   ".to_string());
        let messages = build_messages(&req);
        assert_eq!(messages.len(), 2);
        assert!(!messages[1].content.contains("CUSTOM INSTRUCTIONS"));
    }

    #[test]
    fn meeting_list_questions_get_item_by_item_format_and_full_budget() {
        use crate::backend::MeetingContext;

        let mut req = base_request("you are not understanding i am saying those 11 points can we use repos to assess the client");
        req.meeting = Some(MeetingContext::default());
        assert_eq!(max_tokens_for_question(&req), MEETING_LIST_MAX_TOKENS);
        let prompt = build_messages(&req).last().unwrap().content.clone();
        assert!(prompt.contains("FORMAT 8"));
        assert!(prompt.starts_with("Someone in the meeting says:"));

        // The same wording in an interview keeps the interview classifier.
        let mut interview = req.clone();
        interview.meeting = None;
        assert_ne!(max_tokens_for_question(&interview), MEETING_LIST_MAX_TOKENS);
    }

    #[test]
    fn meeting_answers_never_get_a_short_budget() {
        use crate::backend::MeetingContext;

        let mut req = base_request("What is Kubernetes?");
        req.meeting = Some(MeetingContext::default());
        assert_eq!(max_tokens_for_question(&req), MEETING_MIN_TOKENS);
    }

    #[test]
    fn meeting_followups_label_the_other_side_as_a_participant() {
        use crate::backend::MeetingContext;

        let mut req = base_request("No, I mean the client's platform");
        req.meeting = Some(MeetingContext::default());
        req.conversation_history = vec![ConversationTurn { question: "what about tooling".into(), answer: "We use MLflow.".into() }];
        let prompt = build_messages(&req).last().unwrap().content.clone();
        assert!(prompt.contains("Participant: what about tooling"));
        assert!(!prompt.contains("Interviewer"));
        assert!(!prompt.contains("interviewer"));
    }

    #[test]
    fn meeting_request_uses_meeting_prompt_and_background() {
        use crate::backend::MeetingContext;

        let mut req = base_request("What's the rollout timeline?");
        req.meeting = Some(MeetingContext {
            topic: Some("Client discussion about CrowdStrike deployment".to_string()),
            ..Default::default()
        });
        let messages = build_messages(&req);
        assert_eq!(messages[0].content, super::super::meeting::SYSTEM_PROMPT);
        assert!(messages[1].cacheable);
        assert!(messages[1].content.contains("CrowdStrike deployment"));
        assert!(!messages[1].content.contains("interview"));
        let last = messages.last().unwrap();
        assert!(last.content.starts_with("Someone in the meeting says:"));
    }

    #[test]
    fn classifies_definition_question_as_short() {
        let (_, budget) = classify_length("What is Kubernetes?");
        assert_eq!(budget, 260);
    }

    #[test]
    fn classifies_architecture_question_as_long() {
        let (_, budget) = classify_length("Explain the architecture step by step");
        assert_eq!(budget, 900);
    }

    #[test]
    fn what_is_an_architecture_gets_the_full_walkthrough_length() {
        let (_, arch) = classify_length("what is rag architecture");
        let (_, definition) = classify_length("What is REST?");
        assert_eq!(arch, 600);
        assert_eq!(classify_length("explain architecture").1, 600);
        assert_eq!(classify_length("Explain the RAG architecture in detail").1, 900);
        assert!(classify_format("explain architecture").unwrap().contains("naming its stage"));
        assert_eq!(definition, 260);
        assert!(classify_format("what is rag architecture").unwrap().contains("FORMAT 4"));
    }

    #[test]
    fn classifies_the_question_before_using_the_background() {
        assert!(SYSTEM_PROMPT.contains("FIRST, DECIDE WHAT KIND OF QUESTION THIS IS"));
        assert!(SYSTEM_PROMPT.contains("NEVER FABRICATE THE CANDIDATE'S EXPERIENCE"));
        assert!(SYSTEM_PROMPT.contains("never bring in the candidate's personal or project experience just because it is related"));
    }

    #[test]
    fn nothing_in_the_prompt_invites_invented_experience() {
        // Earlier wording that pushed "we built…" framing or invention.
        for removed in [
            "who has built this in production",
            "the way engineers describe a system they work on",
            "give ONE plausible, ordinary, concrete-sounding name",
            "I've mainly used **RAGAS**",
            "use it fully before falling back",
            "Your own experience gets at most one short sentence",
        ] {
            assert!(!SYSTEM_PROMPT.contains(removed), "still present: {removed}");
        }
        assert!(!classify_format("explain architecture").unwrap().contains("we pull"));
    }

    #[test]
    fn interview_answers_use_the_background_like_a_real_candidate() {
        assert!(SYSTEM_PROMPT.contains("title the resume itself leads with"));
        assert!(SYSTEM_PROMPT.contains("Name a company only when it genuinely matters"));
        assert!(SYSTEM_PROMPT.contains("Concept questions"));
        assert!(SYSTEM_PROMPT.contains("with no mention of your own experience, projects or companies"));
        assert!(SYSTEM_PROMPT.contains("Don't retell a project or story already told"));
    }

    #[test]
    fn interview_answers_never_announce_their_structure() {
        assert!(SYSTEM_PROMPT.contains("Never announce the structure of your answer"));
        assert!(SYSTEM_PROMPT.contains("parrot the question back"));
        assert!(SYSTEM_PROMPT.contains("Never argue against something nobody said"));
        assert!(SYSTEM_PROMPT.contains("Talk, don't write"));
        assert!(SYSTEM_PROMPT.contains("never semicolons"));
        assert!(SYSTEM_PROMPT.contains("Simple words, senior content"));
        assert!(SYSTEM_PROMPT.contains("Calm, not dramatic"));
        assert!(!SYSTEM_PROMPT.contains("LONG, MULTI-PART ANSWERS ONLY"));
        assert!(!classify_format("What are the types of caching?").unwrap().contains("naming how many"));
    }

    #[test]
    fn system_prompt_asks_for_expert_depth_not_beginner_answers() {
        assert!(SYSTEM_PROMPT.contains("EXPERT SUBSTANCE"));
        assert!(SYSTEM_PROMPT.contains("Never answer at a beginner level"));
        assert!(!SYSTEM_PROMPT.contains("USE VERY SIMPLE, EVERYDAY ENGLISH"));
    }

    #[test]
    fn classifies_explicit_full_picture_as_very_long() {
        let (_, budget) = classify_length("Walk me through the complete architecture");
        assert_eq!(budget, 900);
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
        assert_eq!(budget, 600);
    }

    #[test]
    fn brief_answer_length_clamps_but_never_inflates() {
        let mut req = base_request("Explain the architecture step by step");
        req.answer_length = "brief".to_string();
        assert_eq!(max_tokens_for_question(&req), 120);

        let mut req2 = base_request("What is Rust?");
        req2.answer_length = "brief".to_string();
        assert_eq!(max_tokens_for_question(&req2), 120); // question budget (260) clamped down to the brief ceiling
    }

    #[test]
    fn default_and_detailed_never_inflate_budget() {
        let mut req = base_request("What is Rust?");
        req.answer_length = "detailed".to_string();
        assert_eq!(max_tokens_for_question(&req), 260);
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
