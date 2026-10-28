"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { callAdminFunction } from "@/lib/adminApi";
import { createClient } from "@/lib/supabase/client";
import { Unauthorized } from "@/components/Unauthorized";
import { PageLoading } from "@/components/PageLoading";

interface AiUsageSummary {
  tokensToday: number;
  tokensThisWeek: number;
  tokensThisMonth: number;
  estimatedCostUsd: number;
  byModel: { model: string; provider: string; calls: number; totalTokens: number; estimatedCostUsd: number }[];
  byUser: { userId: string; email: string; calls: number; totalTokens: number; estimatedCostUsd: number }[];
}

interface AppConfigResponse {
  settings: Record<string, unknown>;
  apiKeys: unknown[];
}

// Every model the proxy accepts (ALLOWED_MODELS in
// backend/supabase/functions/_shared/llmguard.ts), with OpenAI's standard
// per-1M-token prices (developers.openai.com/api/docs/pricing, Oct 2026 --
// keep in sync with RATE_PER_1K in llm-proxy-v2). Each slot's default goes
// first -- ModelSelector treats options[0] as the default for the
// "default"/"override" badge.
const MODEL_PRICES = [
  { value: "gpt-6-luna",   name: "GPT-6 Luna",   input: 0.1,  output: 0.5 },
  { value: "gpt-5",        name: "GPT-5",        input: 1.25, output: 10.0 },
  { value: "gpt-5-mini",   name: "GPT-5 Mini",   input: 0.25, output: 2.0 },
  { value: "gpt-4.1",      name: "GPT-4.1",      input: 2.0,  output: 8.0 },
  { value: "gpt-4.1-mini", name: "GPT-4.1 Mini", input: 0.4,  output: 1.6 },
  { value: "gpt-4.1-nano", name: "GPT-4.1 Nano", input: 0.1,  output: 0.4 },
  { value: "gpt-4o",       name: "GPT-4o",       input: 2.5,  output: 10.0 },
  { value: "gpt-4o-mini",  name: "GPT-4o Mini",  input: 0.15, output: 0.6 },
] as const;

type ModelOption = (typeof MODEL_PRICES)[number];

const usd = (n: number) => `$${n.toFixed(2)}`;

const ALL_MODELS: readonly ModelOption[] = MODEL_PRICES;

function withDefaultFirst(defaultValue: string) {
  return [
    ...ALL_MODELS.filter((m) => m.value === defaultValue),
    ...ALL_MODELS.filter((m) => m.value !== defaultValue),
  ];
}

const MAIN_MODEL_OPTIONS = withDefaultFirst("gpt-6-luna");
const TRACKING_MODEL_OPTIONS = withDefaultFirst("gpt-6-luna");

function extractValue(settings: Record<string, unknown>, key: string, fallback: string): string {
  const entry = settings[key];
  if (!entry) return fallback;
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && entry !== null && "value" in entry)
    return String((entry as { value: unknown }).value);
  return fallback;
}

async function getToken() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Session expired");
  return session.access_token;
}

function ModelSelector({
  settingKey,
  label,
  currentValue,
  options,
  onSaved,
}: {
  settingKey: string;
  label: string;
  currentValue: string;
  options: readonly ModelOption[];
  onSaved: () => Promise<unknown> | void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(currentValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Follow the saved value whenever it changes (after our own save, or a
  // background refresh) so the list never sits on a stale selection.
  useEffect(() => {
    setSelected(currentValue);
  }, [currentValue]);

  const isDefault = currentValue === options[0]?.value;
  const dirty = selected !== currentValue;
  const current = options.find((o) => o.value === currentValue);

  function close() {
    setOpen(false);
    setSelected(currentValue);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      await callAdminFunction(token, "admin-set-app-setting", {
        type: "setting",
        key: settingKey,
        value: selected,
      });
      await onSaved();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        {isDefault
          ? <span className="badge badge-muted">default</span>
          : <span className="badge badge-ok">override</span>
        }
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-ink">{current?.name ?? currentValue}</span>
        {current && (
          <span className="text-xs tabular-nums text-muted">
            {usd(current.input)} in · {usd(current.output)} out / 1M
          </span>
        )}
        {!open && (
          <button type="button" onClick={() => { setSelected(currentValue); setOpen(true); }} className="btn-secondary text-xs">
            Change
          </button>
        )}
      </div>

      {open && (
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-[1fr_5rem_5rem] gap-2 border-b border-border bg-subtle px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
          <span>Model</span>
          <span className="text-right">Input</span>
          <span className="text-right">Output</span>
        </div>
        <div role="radiogroup" aria-label={label}>
          {options.map((opt, i) => {
            const checked = opt.value === selected;
            const active = opt.value === currentValue;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={checked}
                disabled={saving}
                onClick={() => setSelected(opt.value)}
                className={`grid w-full grid-cols-[1fr_5rem_5rem] items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  checked ? "bg-accent/10 text-ink" : "text-ink/80 hover:bg-subtle"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`h-3.5 w-3.5 shrink-0 rounded-full border ${
                      checked ? "border-accent bg-accent ring-2 ring-inset ring-surface" : "border-border"
                    }`}
                  />
                  <span className={checked ? "font-medium" : ""}>{opt.name}</span>
                  {active && <span className="badge badge-ok">active</span>}
                  {i === 0 && <span className="badge badge-muted">default</span>}
                </span>
                <span className="text-right tabular-nums">{usd(opt.input)}</span>
                <span className="text-right tabular-nums">{usd(opt.output)}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
          <p className="text-[11px] text-muted">Prices per 1M tokens (OpenAI standard rate)</p>
          <div className="flex gap-2">
            <button type="button" disabled={saving} onClick={close} className="btn-secondary text-xs">
              Cancel
            </button>
            <button type="button" disabled={saving || !dirty} onClick={save} className="btn-primary text-xs">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold text-ink">{value}</p>
    </div>
  );
}

export default function AiUsagePage() {
  const { data: summary, error } = useAdminQuery<AiUsageSummary>("admin-ai-usage");
  const { data: appConfig, mutate: mutateConfig } = useAdminQuery<AppConfigResponse>("admin-get-app-settings");

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;
  if (!summary) return <PageLoading error={error} />;

  const settings = appConfig?.settings ?? {};
  const mainModel     = extractValue(settings, "llm_main_model",     "gpt-6-luna");
  const trackingModel = extractValue(settings, "llm_tracking_model", "gpt-6-luna");

  const empty = summary.byModel.length === 0 && summary.byUser.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">AI usage &amp; models</h1>
        <p className="text-sm text-muted">From llm-proxy&apos;s usage_costs logging.</p>
      </div>

      {/* Active model selector */}
      <section className="card">
        <h2 className="text-sm font-semibold text-ink mb-3">Active model</h2>
        <div className="flex flex-col gap-6 xl:flex-row xl:gap-8">
          <ModelSelector
            settingKey="llm_main_model"
            label="Main (answers, analysis, writing)"
            currentValue={mainModel}
            options={MAIN_MODEL_OPTIONS}
            onSaved={() => mutateConfig()}
          />
          <ModelSelector
            settingKey="llm_tracking_model"
            label="Tracking (background)"
            currentValue={trackingModel}
            options={TRACKING_MODEL_OPTIONS}
            onSaved={() => mutateConfig()}
          />
        </div>
      </section>

      {empty && (
        <div className="card text-sm text-muted">
          No AI usage logged yet -- usage_costs is empty. This populates automatically once traffic flows through
          llm-proxy.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Tokens today" value={summary.tokensToday.toLocaleString()} />
        <Stat label="Tokens this week" value={summary.tokensThisWeek.toLocaleString()} />
        <Stat label="Tokens this month" value={summary.tokensThisMonth.toLocaleString()} />
        <Stat label="Estimated cost" value={`$${summary.estimatedCostUsd.toFixed(2)}`} />
      </div>

      {summary.byModel.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">By model</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Provider</th>
                  <th>Calls</th>
                  <th>Tokens</th>
                  <th>Estimated cost</th>
                </tr>
              </thead>
              <tbody>
                {summary.byModel.map((m, i) => (
                  <tr key={i} className={m.model === mainModel ? "bg-primary/5" : ""}>
                    <td>
                      {m.model}
                      {m.model === mainModel && (
                        <span className="ml-2 badge badge-ok text-xs">active</span>
                      )}
                    </td>
                    <td>{m.provider}</td>
                    <td>{m.calls}</td>
                    <td>{m.totalTokens.toLocaleString()}</td>
                    <td>${m.estimatedCostUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {summary.byUser.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">By user (top 50)</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Calls</th>
                  <th>Tokens</th>
                  <th>Estimated cost</th>
                </tr>
              </thead>
              <tbody>
                {summary.byUser.map((u) => (
                  <tr key={u.userId}>
                    <td>
                      <Link href={`/users/${u.userId}`} className="text-accent hover:underline">
                        {u.email}
                      </Link>
                    </td>
                    <td>{u.calls}</td>
                    <td>{u.totalTokens.toLocaleString()}</td>
                    <td>${u.estimatedCostUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
