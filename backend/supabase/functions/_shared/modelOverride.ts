// Forces every proxied LLM request onto the models chosen in the admin
// console (app_settings llm_main_model / llm_tracking_model), whatever model
// the client asked for. That covers the current app (gpt-6-sol / gpt-6-luna),
// older installs that still send gpt-4o / gpt-4.1 / *-mini, and anyone
// calling the proxy directly -- users only ever get the selected models.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface ModelOverrides {
  main: string;     // answers, deep, analysis, writing, images
  tracking: string; // background conversation tracking
}

const DEFAULT_OVERRIDES: ModelOverrides = { main: "gpt-6-sol", tracking: "gpt-6-luna" };

// Module-level cache so we don't hit the DB on every single request. Edge
// function instances are short-lived, so 60s is plenty -- an admin change
// reaches every user within a minute.
let overrideCache: { overrides: ModelOverrides; expiresAt: number } | null = null;

export async function fetchModelOverrides(admin: SupabaseClient): Promise<ModelOverrides> {
  if (overrideCache && Date.now() < overrideCache.expiresAt) return overrideCache.overrides;
  const { data } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", ["llm_main_model", "llm_tracking_model"]);
  const map: Record<string, string> = {};
  for (const row of data ?? []) map[row.key] = row.value;
  const overrides: ModelOverrides = {
    main: map["llm_main_model"] || DEFAULT_OVERRIDES.main,
    tracking: map["llm_tracking_model"] || DEFAULT_OVERRIDES.tracking,
  };
  overrideCache = { overrides, expiresAt: Date.now() + 60_000 };
  return overrides;
}

/// The app doesn't label which requests are background tracking, so the
/// requested model decides the slot: the cheap models every app version has
/// used for tracking (gpt-6-luna now; *-mini / *-nano before it) go to the
/// tracking slot, everything else to main. gpt-5-mini was an answer model,
/// so it stays on main.
function isTrackingRequest(model: string): boolean {
  if (model.startsWith("gpt-5-mini")) return false;
  return model.startsWith("gpt-6-luna") || /-(mini|nano)(-|$)/.test(model);
}

/// Returns true if the model needs reasoning-style params (max_completion_tokens
/// + reasoning_effort instead of max_tokens + temperature).
function isReasoningModel(model: string): boolean {
  return model.startsWith("gpt-6") || model.startsWith("gpt-5") ||
    model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4");
}

/// Swaps in the admin-selected model and translates API parameters when the
/// model family changes (reasoning <-> classic). Returns a new payload object.
// deno-lint-ignore no-explicit-any
export function applyModelOverride(payload: any, overrides: ModelOverrides): any {
  const originalModel: string = payload.model ?? "";
  const newModel = isTrackingRequest(originalModel) ? overrides.tracking : overrides.main;

  if (newModel === originalModel) return payload;

  const wasReasoning = isReasoningModel(originalModel);
  const nowReasoning = isReasoningModel(newModel);

  const updated = { ...payload, model: newModel };

  if (wasReasoning && !nowReasoning) {
    // Reasoning -> classic: max_completion_tokens had a large reasoning buffer
    // added by the Rust client (6000 for gpt-6, 300 for gpt-5). Strip that
    // and convert to max_tokens with a sensible answer cap.
    const buffer = originalModel.startsWith("gpt-6") ? 6000 : 300;
    const answerBudget = Math.min(Math.max((payload.max_completion_tokens ?? 1500) - buffer, 200), 2000);
    delete updated.max_completion_tokens;
    delete updated.reasoning_effort;
    updated.max_tokens = answerBudget;
    if (updated.temperature === undefined) updated.temperature = 1;
  } else if (!wasReasoning && nowReasoning) {
    // Classic -> reasoning: convert max_tokens -> max_completion_tokens.
    const base = payload.max_tokens ?? 600;
    const buffer = newModel.startsWith("gpt-6") ? 6000 : 300;
    delete updated.max_tokens;
    delete updated.temperature;
    updated.max_completion_tokens = base + buffer;
    updated.reasoning_effort = "low";
  }
  // Same family (both reasoning or both classic): params are compatible as-is.
  return updated;
}
