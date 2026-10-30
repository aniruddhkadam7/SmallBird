"use client";

// OpenAI credit left, from admin-openai-balance. OpenAI has no balance API,
// so the admin enters the balance shown on OpenAI's billing page and the
// function subtracts the real spend since then.

import { useState } from "react";
import { useAdminQuery } from "@/lib/useAdminQuery";
import { callAdminFunction } from "@/lib/adminApi";
import { createClient } from "@/lib/supabase/client";
import { SpendChart } from "@/components/SpendChart";
import { MoneyStat } from "@/components/MoneyStat";

interface OpenAiBalance {
  configured: boolean;
  enteredBalanceUsd?: number | null;
  balanceSetAt?: string | null;
  spentSinceBalanceUsd?: number | null;
  creditLeftUsd?: number | null;
  spentTodayUsd?: number;
  spentThisMonthUsd?: number;
  otherKeysThisMonthUsd?: number;
  usdToInr?: number;
  daily?: {
    date: string;
    usd: number;
    otherKeysUsd?: number;
    calls?: number;
    users?: number;
    interviews?: number;
    tokens?: number;
  }[];
}

const BILLING_URL = "https://platform.openai.com/settings/organization/billing/overview";
const LOW_CREDIT_USD = 5;

const usd = (n: number) => `$${n.toFixed(2)}`;

async function saveSetting(token: string, key: string, value: string) {
  await callAdminFunction(token, "admin-set-app-setting", { type: "setting", key, value });
}

export function OpenAiBalancePanel() {
  const { data, error, mutate } = useAdminQuery<OpenAiBalance>("admin-openai-balance");
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save() {
    const amount = Number(input);
    if (!Number.isFinite(amount) || amount < 0) {
      setSaveError("Enter the balance in dollars, e.g. 18.50");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Session expired");
      await saveSetting(session.access_token, "openai_balance_usd", amount.toFixed(2));
      await saveSetting(session.access_token, "openai_balance_set_at", new Date().toISOString());
      await mutate();
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const header = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-ink">OpenAI · SmallBird key</h2>
      <a href={BILLING_URL} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
        Open OpenAI billing ↗
      </a>
    </div>
  );

  if (error) {
    return (
      <section className="card">
        {header}
        <p className="text-sm text-danger">{error instanceof Error ? error.message : "Could not load OpenAI spend"}</p>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="card">
        {header}
        <p className="text-sm text-muted">Loading…</p>
      </section>
    );
  }

  if (!data.configured) {
    return (
      <section className="card">
        {header}
        <p className="text-sm text-muted">
          Set the <code>OPENAI_ADMIN_KEY</code> Supabase secret (an <code>sk-admin-</code> key) to see OpenAI spend and
          credit left.
        </p>
      </section>
    );
  }

  const left = data.creditLeftUsd ?? null;
  const daily = data.daily ?? [];
  const rate = data.usdToInr ?? 95;
  const inr = (n: number) =>
    `₹${(n * rate).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <section className="card">
      {header}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MoneyStat
          label="Credit left (approx.)"
          usd={left === null ? null : Math.max(0, left)}
          rate={rate}
          danger={left !== null && left < LOW_CREDIT_USD}
        />
        <MoneyStat label="Spent today" usd={data.spentTodayUsd ?? 0} rate={rate} />
        <MoneyStat label="Spent this month" usd={data.spentThisMonthUsd ?? 0} rate={rate} />
        <MoneyStat label="Spent since entry (all keys)" usd={data.spentSinceBalanceUsd ?? null} rate={rate} />
      </div>

      <div className="mt-5">
        <p className="mb-2 text-xs font-medium text-ink">SmallBird key — what it cost each day</p>
        <SpendChart
          days={daily}
          usdToInr={rate}
          describe={(d) => (
            <>
              <b className="text-ink">{d.calls ?? 0}</b> AI calls · <b className="text-ink">{d.users ?? 0}</b>{" "}
              {d.users === 1 ? "person" : "people"} · <b className="text-ink">{d.interviews ?? 0}</b>{" "}
              {d.interviews === 1 ? "interview" : "interviews"} · {(d.tokens ?? 0).toLocaleString()} tokens
              {d.calls ? <> · {inr(d.usd / d.calls)} per call</> : null}
              {(d.otherKeysUsd ?? 0) > 0.0005 && <> · your other keys spent {inr(d.otherKeysUsd ?? 0)} more</>}
            </>
          )}
        />
      </div>

      {(data.otherKeysThisMonthUsd ?? 0) > 0.005 && (
        <p className="mt-3 text-xs text-muted">
          Spend above is the SmallBird key only. Your other OpenAI keys spent {usd(data.otherKeysThisMonthUsd ?? 0)} this
          month from the same credit, so credit left counts them too.
        </p>
      )}

      <div className="mt-4 border-t border-border pt-3">
        {left === null && !editing && (
          <p className="mb-2 text-xs text-muted">
            OpenAI doesn&apos;t share the balance through its API. Enter the balance from the OpenAI billing page once,
            and this card subtracts the spend after that.
          </p>
        )}
        {left !== null && !editing && (
          <p className="mb-2 text-xs text-muted">
            Based on {usd(data.enteredBalanceUsd ?? 0)} entered on{" "}
            {data.balanceSetAt ? new Date(data.balanceSetAt).toLocaleString() : "—"}. Update it after each top-up.
          </p>
        )}

        {editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Balance on OpenAI billing page"
              className="input w-56 text-sm"
            />
            <button type="button" disabled={saving} onClick={() => { setEditing(false); setSaveError(null); }} className="btn-secondary text-xs">
              Cancel
            </button>
            <button type="button" disabled={saving || input.trim() === ""} onClick={save} className="btn-primary text-xs">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setInput(left === null ? "" : Math.max(0, left).toFixed(2)); setEditing(true); }}
            className="btn-secondary text-xs"
          >
            {left === null ? "Enter balance" : "Update balance"}
          </button>
        )}
        {saveError && <p className="mt-2 text-xs text-danger">{saveError}</p>}
      </div>
    </section>
  );
}
