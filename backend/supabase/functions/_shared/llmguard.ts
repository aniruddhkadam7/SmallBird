// Limits on what llm-proxy / llm-proxy-v2 will forward with OUR provider
// keys. Without these, anyone signed in could call the proxy directly (not
// through the app) with any model — including the most expensive ones — huge
// token limits, n=100 or tool calls, in a tight loop, and run up real
// OpenAI/Anthropic cost. Everything the desktop app itself sends passes
// untouched: its models are all allowed and its token limits are far below
// the caps (largest today: 1500 + a 6000 reasoning budget).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { allowRequest } from "./ratelimit.ts";

/// Models the app has ever sent (every version still installed), plus their
/// dated snapshots (e.g. gpt-4o-2024-08-06, claude-3-5-sonnet-20241022).
const ALLOWED_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-5",
  "gpt-5-mini",
  "gpt-6-sol",
  "gpt-6-luna",
  "claude-sonnet-5",
  "claude-haiku-4-5",
  "claude-3-5-sonnet",
];
const DATED_SUFFIX = /^-(\d{4}-\d{2}-\d{2}|\d{8})$/;

export function isAllowedModel(model: unknown): boolean {
  if (typeof model !== "string") return false;
  return ALLOWED_MODELS.some((m) => model === m || (model.startsWith(m) && DATED_SUFFIX.test(model.slice(m.length))));
}

const MAX_TOKENS_CAP = 4096;
const MAX_COMPLETION_TOKENS_CAP = 12000;
/// Largest request body accepted (screenshots/images are sent inline as
/// base64, so this is generous).
export const MAX_BODY_BYTES = 20 * 1024 * 1024;

/// Returns a copy of the provider payload with the cost-relevant knobs
/// clamped: token limits capped, a single completion, no tools.
// deno-lint-ignore no-explicit-any
export function sanitizePayload(payload: any): any {
  const out = { ...payload };
  if (typeof out.max_tokens === "number") out.max_tokens = Math.min(out.max_tokens, MAX_TOKENS_CAP);
  if (typeof out.max_completion_tokens === "number") {
    out.max_completion_tokens = Math.min(out.max_completion_tokens, MAX_COMPLETION_TOKENS_CAP);
  }
  delete out.n;
  delete out.best_of;
  delete out.tools;
  delete out.tool_choice;
  delete out.functions;
  delete out.function_call;
  return out;
}

/// Per-user request rate. A real session sends a handful of calls per
/// question (answer + conversation tracking + images); these limits are far
/// above that and only stop scripted abuse.
export async function withinRateLimit(admin: SupabaseClient, userId: string): Promise<boolean> {
  const [minute, hour] = await Promise.all([
    allowRequest(admin, `llm-min:${userId}`, 120, 60),
    allowRequest(admin, `llm-hour:${userId}`, 1500, 3600),
  ]);
  return minute && hour;
}
