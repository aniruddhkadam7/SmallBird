"use client";

// Deepgram (speech-to-text) balance and real spend, from
// admin-deepgram-usage. Unlike OpenAI, Deepgram reports its balance and each
// request's exact cost, so nothing here is estimated.

import { useAdminQuery } from "@/lib/useAdminQuery";
import { SpendChart } from "@/components/SpendChart";
import { MoneyStat as Money } from "@/components/MoneyStat";

interface DeepgramUsage {
  configured: boolean;
  balanceUsd?: number | null;
  usdToInr?: number;
  todayUsd?: number;
  thisMonthUsd?: number;
  totalUsd?: number;
  interviewUsd?: number;
  daily?: { date: string; usd: number; minutes?: number; requests?: number; interviews?: number; users?: number }[];
}

const CONSOLE_URL = "https://console.deepgram.com/";
const LOW_BALANCE_USD = 5;

export function DeepgramUsagePanel() {
  const { data, error } = useAdminQuery<DeepgramUsage>("admin-deepgram-usage");

  const header = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-ink">Deepgram (speech-to-text)</h2>
      <a href={CONSOLE_URL} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
        Open Deepgram console ↗
      </a>
    </div>
  );

  if (error || !data) {
    return (
      <section className="card">
        {header}
        <p className={`text-sm ${error ? "text-danger" : "text-muted"}`}>
          {error ? (error instanceof Error ? error.message : "Could not load Deepgram usage") : "Loading…"}
        </p>
      </section>
    );
  }

  if (!data.configured) {
    return (
      <section className="card">
        {header}
        <p className="text-sm text-muted">DEEPGRAM_API_KEY / DEEPGRAM_PROJECT_ID aren&apos;t set.</p>
      </section>
    );
  }

  const rate = data.usdToInr ?? 95;
  const both = (usd: number) =>
    `$${usd.toFixed(2)} · ₹${(usd * rate).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const daily = data.daily ?? [];
  const inr = (n: number) =>
    `₹${(n * rate).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const otherUsd = Math.max(0, (data.totalUsd ?? 0) - (data.interviewUsd ?? 0));

  return (
    <section className="card">
      {header}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Money
          label="Balance left"
          usd={data.balanceUsd ?? null}
          rate={rate}
          danger={data.balanceUsd != null && data.balanceUsd < LOW_BALANCE_USD}
        />
        <Money label="Spent today" usd={data.todayUsd ?? 0} rate={rate} />
        <Money label="Spent this month" usd={data.thisMonthUsd ?? 0} rate={rate} />
        <Money label="Spent all time" usd={data.totalUsd ?? 0} rate={rate} />
      </div>

      <div className="mt-5">
        <p className="mb-2 text-xs font-medium text-ink">What speech-to-text cost each day</p>
        <SpendChart
          days={daily}
          usdToInr={rate}
          describe={(d) => (
            <>
              <b className="text-ink">{Number(d.minutes ?? 0).toFixed(1)}</b> minutes transcribed ·{" "}
              <b className="text-ink">{d.interviews ?? 0}</b> {d.interviews === 1 ? "interview" : "interviews"} ·{" "}
              <b className="text-ink">{d.users ?? 0}</b> {d.users === 1 ? "person" : "people"} · {d.requests ?? 0}{" "}
              {d.requests === 1 ? "connection" : "connections"}
              {d.minutes ? <> · {inr(d.usd / Number(d.minutes))} per minute</> : null}
            </>
          )}
        />
      </div>

      <p className="mt-3 text-xs text-muted">
        Exact figures from Deepgram. {both(data.interviewUsd ?? 0)} is matched to interviews (shown per user and per
        interview on the Users pages)
        {otherUsd > 0.005 && `; ${both(otherUsd)} isn’t — interviews from before 26 Sep 2026 didn’t save their key`}.
      </p>
    </section>
  );
}
