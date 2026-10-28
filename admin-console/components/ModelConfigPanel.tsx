"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { callAdminFunction, AdminApiError } from "@/lib/adminApi";

// Models allowed by llmguard.ts + their human labels. Reasoning-style models
// (gpt-6-*, gpt-5-*) use max_completion_tokens + reasoning_effort in the
// OpenAI API; classic models use max_tokens + temperature. The proxy handles
// the parameter translation automatically when an override is applied.
const MODEL_OPTIONS = [
  { value: "gpt-6-luna",  label: "GPT-6 Luna — fast, cheapest GPT-6 (default)" },
  { value: "gpt-4.1",     label: "GPT-4.1 — strong classic" },
  { value: "gpt-4.1-mini",label: "GPT-4.1 Mini — cheaper still, good quality" },
  { value: "gpt-4.1-nano",label: "GPT-4.1 Nano — fastest classic, cheapest" },
  { value: "gpt-5-mini",  label: "GPT-5 Mini — GPT-5 family (note: no Markdown in answers)" },
  { value: "gpt-4o",      label: "GPT-4o — OpenAI classic" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini — cheap classic" },
] as const;

const TRACKING_OPTIONS = [
  { value: "gpt-6-luna",  label: "GPT-6 Luna — fast background model (default)" },
  { value: "gpt-4.1-nano",label: "GPT-4.1 Nano — cheapest option" },
  { value: "gpt-4.1-mini",label: "GPT-4.1 Mini" },
  { value: "gpt-4.1",     label: "GPT-4.1" },
] as const;

interface ModelSlot {
  settingKey: string;
  label: string;
  description: string;
  currentValue: string;
  options: readonly { value: string; label: string }[];
}

interface Props {
  settings: Record<string, unknown>;
  onSuccess: () => void;
}

async function getToken() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Session expired — please sign in again.");
  return session.access_token;
}

function ModelRow({ slot, onSuccess }: { slot: ModelSlot; onSuccess: () => void }) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(slot.currentValue);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDefault = slot.currentValue === (slot.options[0]?.value ?? "");

  async function save() {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      await callAdminFunction(token, "admin-set-app-setting", {
        type: "setting",
        key: slot.settingKey,
        value: selected,
      });
      setEditing(false);
      onSuccess();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{slot.label}</p>
          <p className="text-xs text-muted">{slot.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-xs text-muted">{slot.currentValue}</span>
          {isDefault
            ? <span className="badge badge-muted">default</span>
            : <span className="badge badge-ok">override</span>
          }
        </div>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      {!editing ? (
        <button
          type="button"
          onClick={() => { setSelected(slot.currentValue); setEditing(true); }}
          className="btn-secondary text-xs"
        >
          Change model
        </button>
      ) : (
        <div className="space-y-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="input text-sm w-full"
          >
            {slot.options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={loading || selected === slot.currentValue}
              onClick={save}
              className="btn-primary text-xs"
            >
              {loading ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => { setEditing(false); setError(null); }}
              className="btn-secondary text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function extractValue(settings: Record<string, unknown>, key: string, fallback: string): string {
  const entry = settings[key];
  if (!entry) return fallback;
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && entry !== null && "value" in entry) return String((entry as { value: unknown }).value);
  return fallback;
}

export function ModelConfigPanel({ settings, onSuccess }: Props) {
  const mainModel   = extractValue(settings, "llm_main_model",     "gpt-6-luna");
  const trackModel  = extractValue(settings, "llm_tracking_model", "gpt-6-luna");

  const slots: ModelSlot[] = [
    {
      settingKey:   "llm_main_model",
      label:        "Main AI model",
      description:  "Used for live answers, deep mode, analysis, writing, and image reading. Changing this immediately affects all new requests.",
      currentValue: mainModel,
      options:      MODEL_OPTIONS,
    },
    {
      settingKey:   "llm_tracking_model",
      label:        "Tracking model",
      description:  "Background conversation tracker that runs after every answer. Keep it cheap — it only extracts topic/entity JSON.",
      currentValue: trackModel,
      options:      TRACKING_OPTIONS,
    },
  ];

  return (
    <section className="card">
      <h2 className="text-sm font-semibold text-ink">AI model selection</h2>
      <p className="mt-1 text-xs text-muted">
        Override which OpenAI model the app uses. Changes take effect immediately for all new requests —
        no deploy or app update needed. The proxy handles parameter translation automatically.
      </p>
      <div className="mt-4 space-y-3">
        {slots.map((slot) => (
          <ModelRow key={slot.settingKey} slot={slot} onSuccess={onSuccess} />
        ))}
      </div>
    </section>
  );
}
