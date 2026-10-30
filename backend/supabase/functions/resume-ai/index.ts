// AI for the website's resume builder (smallbird.in/resume/<id>). Unlike
// llm-proxy, the prompts live here and the client only sends its data, so
// this can't be used as a general-purpose free chat endpoint.
//
// Every signed-in user gets it, including Free, and it does NOT spend
// interview minutes (the builder is a way in for new users). What bounds its
// cost is a daily number of AI actions set per plan (public.plans
// .resume_ai_per_day, migration 0050).
//
// Request body, one of:
//   { action: "import", text }                    old resume text -> resume JSON
//   { action: "tailor", resume, jobDescription, instructions? }
//                                                 resume JSON + JD -> rewritten resume JSON
//   { action: "improve", entry, jobDescription? } one entry -> rewritten items
//   { action: "edit", resume, instructions, jobDescription? }
//                                                 resume JSON + the user's request -> changed resume JSON
//   { action: "rewrite", text, instructions?, context?, jobDescription? }
//                                                 one line or paragraph -> rewritten text
// "instructions" is whatever the user typed, e.g. "make my summary shorter".
// The resume JSON shape is src/lib/resume/types.ts in SmallBird-website; the
// website normalizes whatever comes back, so this only checks it's an object.

import { createClient } from "npm:@supabase/supabase-js@2";
import { userIdFromVerifiedJwt } from "../_shared/entitlement.ts";
import { withCors } from "../_shared/cors.ts";
import { allowRequest } from "../_shared/ratelimit.ts";
import { applyModelOverride, fetchModelOverrides } from "../_shared/modelOverride.ts";
import { sanitizePayload } from "../_shared/llmguard.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const MAX_BODY_BYTES = 200_000;
const MAX_TEXT_CHARS = 30_000;
const MAX_JD_CHARS = 15_000;
const MAX_INSTRUCTION_CHARS = 1_000;
const PER_MINUTE = 8;
/// If the plan row can't be read: the Free plan's number, never more.
const FALLBACK_PER_DAY = 5;

// Same estimate table as llm-proxy-v2, for the models the admin console can select.
const RATE_PER_1K: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4o": { input: 0.0025, output: 0.01 },
  "gpt-4.1": { input: 0.002, output: 0.008 },
  "gpt-4.1-mini": { input: 0.0004, output: 0.0016 },
  "gpt-5": { input: 0.00125, output: 0.01 },
  "gpt-5-mini": { input: 0.00025, output: 0.002 },
  "gpt-6-sol": { input: 0.002, output: 0.01 },
  "gpt-6-luna": { input: 0.0001, output: 0.0005 },
};

function rateFor(model: string) {
  const key = Object.keys(RATE_PER_1K)
    .sort((a, b) => b.length - a.length)
    .find((k) => model === k || model.startsWith(`${k}-`));
  return key ? RATE_PER_1K[key] : undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const SHAPE = `RESUME JSON SHAPE
{
  "name": "Full name",
  "tagline": "Short headline under the name, e.g. Software Engineer • Technical Lead, or \"\"",
  "contact": [{ "label": "E-mail", "value": "..." }, { "label": "Phone", "value": "..." }, { "label": "Location", "value": "..." }, { "label": "LinkedIn", "value": "..." }],
  "sections": [
    { "title": "Summary", "kind": "text", "text": "2-3 sentences" },
    { "title": "Work experience", "kind": "entries", "listStyle": "bullets",
      "entries": [{ "heading": "Company", "headingRight": "Start - End", "subheading": "Job title", "subheadingRight": "City, Country", "items": ["One achievement per item"] }] },
    { "title": "Education", "kind": "entries", "listStyle": "italic",
      "entries": [{ "heading": "Degree name", "headingRight": "College", "subheading": "Program / grade", "subheadingRight": "Start - End", "items": ["Thesis, honours, key project"] }] },
    { "title": "Technical skills", "kind": "table", "rows": [{ "label": "Languages", "value": "Python, SQL, ..." }] }
  ]
}
- "kind" is "text", "entries" or "table". "listStyle" is "bullets" (work, projects), "italic" (education details) or "plain" (a short paragraph per entry).
- A project is an entry with "heading": project name, "subheading": its tech stack, and both right sides "" (unless it has dates).
- Wrap a short lead-in in **double asterisks** to make it bold, e.g. "**Relevant Coursework:** DSA, OS".
- An item starting with "- " is a sub-point under the item before it.
- Details of a job's project go first in its items as "**Project:** ...", "**Client:** ...", "**Role(s):** ...", "**Technologies:** ...", then the achievements.
- Leave a field as "" when the information isn't there. Never invent it.`;

const HONESTY = `HONESTY RULES (most important)
- Never add a job, degree, company, date, tool, certificate, number or result that isn't in the input.
- You may reword, reorder, merge, split and cut. You may not make anything up.
- If a number would help but none is given, keep the sentence without one.`;

/** For the actions where the user types a request: facts they state there count as input. */
const USER_FACTS = `- The person's own request may state new facts about them (a new job, a skill, a number). You may use those. Nothing else may be added.
- If the request asks you to invent something (fake numbers, a job they didn't do), don't; do the rest of the request.`;

const STYLE = `WRITING STYLE
- Simple, clear English. Start each bullet with a strong past-tense verb (present tense for a current job).
- One idea per bullet, about 12-25 words. No "responsible for", no "various", no buzzwords like "leverage", "synergy", "robust", "spearheaded".
- Keep real tool names, numbers and names exactly as written.`;

const PROMPTS = {
  import: `You turn the text of an existing resume into structured JSON for a resume builder.
${SHAPE}
${HONESTY}
- Keep the person's own order of sections. Put contact details (email, phone, city, LinkedIn, GitHub, website) in "contact", not in a section.
- Copy the wording mostly as it is. Only fix obvious broken line wraps and spacing from PDF extraction.
Reply with ONLY the resume JSON object.`,

  tailor: `You tailor a resume to one job description, so it gets past ATS filters and a recruiter sees the fit in 10 seconds.
${SHAPE}
${HONESTY}
${STYLE}
WHAT TO DO
- Rewrite the summary (add a "Summary" text section first if there is none) so it speaks to this job, using only real experience.
- In each entry, put the bullets most relevant to the job first, and reword them using the job description's own words where the meaning is truly the same.
- Reorder skills so the ones the job asks for come first. Do not add skills the person didn't list.
- Keep every section, entry, date and contact detail. Keep each section's "kind" and "listStyle".
- If the person gives extra instructions, follow them as long as they don't break the honesty rules.
Reply with ONLY this JSON object:
{ "resume": <the full tailored resume JSON>, "missingSkills": ["skills or tools the job asks for that the resume never mentions, max 10"], "changes": ["short plain-English notes on what you changed, max 5"] }`,

  improve: `You rewrite the items of one resume entry so they read stronger.
${HONESTY}
${STYLE}
- If a job description is given, put what matters most for it first and use its words where the meaning is truly the same.
- Return the same number of items or fewer. Never more.
Reply with ONLY this JSON object: { "items": ["..."] }`,

  edit: `You change a resume the way its owner asks, e.g. "rewrite my summary", "make the bullets shorter", "fix grammar", "fit it on one page".
${SHAPE}
${HONESTY}
${USER_FACTS}
${STYLE}
WHAT TO DO
- Do what the request asks and leave everything else exactly as it is, word for word.
- Keep every "id" field that is in the input. Keep each section's "kind" and "listStyle" unless the request is about them.
- If a job description is given, use it only when the request is about fitting the job.
Reply with ONLY this JSON object:
{ "resume": <the full resume JSON after the change>, "changes": ["short plain-English notes on what you changed, max 5"] }`,

  rewrite: `You rewrite one line or paragraph of a resume.
${HONESTY}
${USER_FACTS}
${STYLE}
- If the person says how to change it, do that. If not, make it clearer and stronger.
- Keep **double asterisks** around a bold lead-in if the text has one, and a leading "- " if it has one.
- One line in gives one line out. A paragraph in gives a paragraph out.
Reply with ONLY this JSON object: { "text": "..." }`,
} as const;

type Action = keyof typeof PROMPTS;

function userMessage(action: Action, body: Record<string, unknown>): string | null {
  const jd = typeof body.jobDescription === "string" ? body.jobDescription.trim().slice(0, MAX_JD_CHARS) : "";
  const asked = typeof body.instructions === "string" ? body.instructions.trim().slice(0, MAX_INSTRUCTION_CHARS) : "";
  const request = asked ? `THE PERSON'S REQUEST:\n${asked}\n\n` : "";
  const resume = () => `RESUME JSON:\n${JSON.stringify(body.resume).slice(0, MAX_TEXT_CHARS * 2)}`;
  const hasResume = !!body.resume && typeof body.resume === "object";
  if (action === "import") {
    const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT_CHARS) : "";
    return text ? `RESUME TEXT:\n${text}` : null;
  }
  if (action === "tailor") {
    if (!hasResume || !jd) return null;
    return `JOB DESCRIPTION:\n${jd}\n\n${request}${resume()}`;
  }
  if (action === "edit") {
    if (!hasResume || !asked) return null;
    return `${request}${jd ? `JOB DESCRIPTION:\n${jd}\n\n` : ""}${resume()}`;
  }
  if (action === "rewrite") {
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 3_000) : "";
    if (!text) return null;
    const context = typeof body.context === "string" ? body.context.trim().slice(0, 300) : "";
    return `${request}${jd ? `JOB DESCRIPTION:\n${jd}\n\n` : ""}${context ? `WHERE IT IS: ${context}\n\n` : ""}TEXT:\n${text}`;
  }
  if (!body.entry || typeof body.entry !== "object") return null;
  return `${jd ? `JOB DESCRIPTION:\n${jd}\n\n` : ""}ENTRY:\n${JSON.stringify(body.entry).slice(0, MAX_TEXT_CHARS)}`;
}

const MAX_TOKENS: Record<Action, number> = { import: 4000, tailor: 4000, improve: 1000, edit: 4000, rewrite: 600 };

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ error: "Request too large" }, 413);
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Please sign in again." }, 401);
    const userId = userIdFromVerifiedJwt(jwt);

    const [profile, settings, plan, minuteOk, raw] = await Promise.all([
      admin.from("profiles").select("is_banned").eq("id", userId).maybeSingle(),
      admin.from("app_settings").select("key, value").in("key", ["maintenance_mode", "maintenance_message"]),
      admin.from("entitlements").select("plans(display_name, resume_ai_per_day)").eq("user_id", userId).maybeSingle(),
      allowRequest(admin, `resume-min:${userId}`, PER_MINUTE, 60),
      req.text(),
    ]);
    // deno-lint-ignore no-explicit-any
    const planRow = (plan.data as any)?.plans as { display_name?: string; resume_ai_per_day?: number } | null;
    const perDay = Number(planRow?.resume_ai_per_day ?? FALLBACK_PER_DAY);
    const dayOk = minuteOk ? await allowRequest(admin, `resume-day:${userId}`, perDay, 86_400) : true;
    if (profile.data?.is_banned) return json({ error: "Your account has been suspended. Please contact support." }, 403);
    const settingsMap = Object.fromEntries((settings.data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    if (settingsMap["maintenance_mode"] === "true") {
      return json({ error: settingsMap["maintenance_message"] ?? "SmallBird is under maintenance. Please check back shortly.", code: "MAINTENANCE" }, 503);
    }
    if (!minuteOk) return json({ error: "Too many AI requests. Please wait a minute and try again." }, 429);
    if (!dayOk) {
      return json({
        error: `You've used today's ${perDay} AI actions on ${planRow?.display_name ?? "your plan"}. They reset in 24 hours, or upgrade for more. You can still edit by hand.`,
        code: "RESUME_AI_LIMIT",
      }, 429);
    }
    if (raw.length > MAX_BODY_BYTES) return json({ error: "Request too large" }, 413);

    const body = JSON.parse(raw) as Record<string, unknown>;
    const action = body.action as Action;
    if (!(action in PROMPTS)) return json({ error: "Unknown action" }, 400);
    const content = userMessage(action, body);
    if (!content) return json({ error: "Nothing to work with — please add the text first." }, 400);

    // Built as a classic request and passed through the same override as
    // llm-proxy, so it follows the model chosen in the admin console.
    const payload = applyModelOverride(
      sanitizePayload({
        model: "gpt-4o",
        messages: [
          { role: "system", content: PROMPTS[action] },
          { role: "user", content },
        ],
        temperature: 0.3,
        max_tokens: MAX_TOKENS[action],
        response_format: { type: "json_object" },
      }),
      await fetchModelOverrides(admin),
    );

    const providerResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
      body: JSON.stringify(payload),
    });
    const result = await providerResp.json().catch(() => null);
    if (!providerResp.ok || !result) {
      console.error("resume-ai: provider error", providerResp.status, result?.error);
      return json({ error: "The AI couldn't finish that. Please try again." }, 502);
    }

    const model: string = result.model ?? payload.model;
    const inputTokens = result.usage?.prompt_tokens ?? 0;
    const outputTokens = result.usage?.completion_tokens ?? 0;
    const rate = rateFor(model);
    admin
      .from("usage_costs")
      .insert({
        user_id: userId,
        provider: "openai",
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: rate ? (inputTokens / 1000) * rate.input + (outputTokens / 1000) * rate.output : null,
        request_kind: `resume_${action}`,
        session_id: null,
      })
      .then(({ error }) => error && console.error("usage_costs insert failed", error));

    let parsed: unknown = null;
    let cutOff = false;
    try {
      parsed = JSON.parse(result.choices?.[0]?.message?.content ?? "");
    } catch {
      cutOff = true;
    }

    // What the user gave the AI and what it gave back, for the admin
    // console's Resume Builder page (migrations 0052, 0053). Capped like the
    // prompt itself; result is null when the reply couldn't be read.
    const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
    const where = str(body.context, 300);
    const inputText =
      action === "rewrite" ? str(body.text, 3_000)
      : action === "improve" && body.entry ? JSON.stringify(body.entry).slice(0, MAX_TEXT_CHARS)
      : null;
    admin
      .from("resume_ai_requests")
      .insert({
        user_id: userId,
        action,
        uploaded_text: action === "import" ? str(body.text, MAX_TEXT_CHARS) : null,
        job_description: str(body.jobDescription, MAX_JD_CHARS),
        instructions: str(body.instructions, MAX_INSTRUCTION_CHARS),
        input_text: inputText && where ? `${where}\n\n${inputText}` : inputText,
        result: parsed && typeof parsed === "object" ? parsed : null,
      })
      .then(({ error }) => error && console.error("resume_ai_requests insert failed", error));

    if (cutOff) return json({ error: "The AI's reply was cut off. Please try again." }, 502);
    if (!parsed || typeof parsed !== "object") return json({ error: "The AI's reply was empty. Please try again." }, 502);
    return json(parsed);
  } catch (err) {
    console.error("resume-ai", err);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}));
