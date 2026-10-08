"use client";

import Link from "next/link";
import { useState } from "react";
import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { callAdminFunction } from "@/lib/adminApi";
import { createClient } from "@/lib/supabase/client";
import { Unauthorized } from "@/components/Unauthorized";

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

const MAIN_MODEL_OPTIONS = [
  { value: "gpt-6-sol",    label: "GPT-6 Sol (default, highest cost)" },
  { value: "gpt-4.1",      label: "GPT-4.1 (strong & cheaper)" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 Mini (cheaper still)" },
  { value: "gpt-4.1-nano", label: "GPT-4.1 Nano (cheapest classic)" },
  { value: "gpt-5-mini",   label: "GPT-5 Mini (no Markdown in answers)" },
  { value: "gpt-4o",       label: "GPT-4o" },
  { value: "gpt-4o-mini",  label: "GPT-4o Mini" },
] as const;

const TRACKING_MODEL_OPTIONS = [
  { value: "gpt-6-luna",   label: "GPT-6 Luna (default)" },
  { value: "gpt-4.1-nano", label: "GPT-4.1 Nano (cheapest)" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
] as const;

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
  activeModel,   // model name currently dominating costs (from usage table)
  onSaved,
}: {
  settingKey: string;
  label: string;
  currentValue: string;
  options: readonly { value: string; label: string }[];
  activeModel?: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(currentValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDefault = currentValue === options[0]?.value;
  const mismatch = activeModel && activeModel !== currentValue;

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
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <p className="text-xs font-medium text-muted uppercase tracking-wide">{label}</p>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-sm font-semibold text-ink">{currentValue}</span>
        {isDefault
          ? <span className="badge badge-muted">default</span>
          : <span className="badge badge-ok">override</span>
        }
        {mismatch && (
          <span className="badge badge-warn text-xs" title={`Traffic hitting ${activeModel} — may be a cached instance`}>
            traffic on {activeModel}
          </span>
        )}
        {!open && (
          <button
            type="button"
            onClick={() => { setSelected(currentValue); setOpen(true); }}
            className="btn-secondary text-xs"
          >
            Change
          </button>
        )}
      </div>

      {open && (
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="input text-sm"
            style={{ minWidth: "260px" }}
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={saving || selected === currentValue}
            onClick={save}
            className="btn-primary text-xs"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => { setOpen(false); setError(null); }}
            className="btn-secondary text-xs"
          >
            Cancel
          </button>
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
  if (!summary) return null;

  const settings = appConfig?.settings ?? {};
  const mainModel     = extractValue(settings, "llm_main_model",     "gpt-6-sol");
  const trackingModel = extractValue(settings, "llm_tracking_model", "gpt-6-luna");

  // Top model by call count from usage table — shows what's actually flowing
  const topModel = summary.byModel[0]?.model;

  const empty = summary.byModel.length === 0 && summary.byUser.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">AI usage</h1>
        <p className="text-sm text-muted">From llm-proxy&apos;s usage_costs logging.</p>
      </div>

      {/* Active model selector */}
      <section className="card">
        <h2 className="text-sm font-semibold text-ink mb-3">Active model</h2>
        <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
          <ModelSelector
            settingKey="llm_main_model"
            label="Main (answers, analysis, writing)"
            currentValue={mainModel}
            options={MAIN_MODEL_OPTIONS}
            activeModel={topModel}
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
