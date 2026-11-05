"use client";

// Home page graphs: website visitors per day and new sign-ups per day, with a
// 7 / 14 / 30 / 90 day switch. Read with the same admin_web_analytics function
// as the Analytics page (admin-only, days in India time); each bar is tappable
// for that day's numbers. Bars are plain CSS, like the rest of the console.

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface Day {
  day: string; // YYYY-MM-DD, India time
  visitors: number;
  pageviews: number;
  signups: number;
  paid: number;
}

const RANGES = [7, 14, 30, 90] as const;

async function fetchDaily(days: number): Promise<Day[]> {
  const { data, error } = await createClient().rpc("admin_web_analytics", { p_days: days });
  if (error) throw new Error(error.message);
  return ((data as { daily?: Day[] })?.daily ?? []) as Day[];
}

const shortDay = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const longDay = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

/// A round top for the y axis, with three evenly spaced ticks.
function axis(max: number) {
  if (max <= 4) return { top: 4, ticks: [0, 2, 4] };
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s * 2 >= max) ?? 10 * magnitude;
  return { top: step * 2, ticks: [0, step, step * 2] };
}

function BarChart({
  title,
  days,
  pick,
  unit,
  color,
  secondary,
}: {
  title: string;
  days: Day[];
  pick: (d: Day) => number;
  unit: string;
  color: string;
  secondary?: (d: Day) => string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(0, ...days.map(pick));
  const { top, ticks } = axis(max);
  const labelEvery = days.length <= 10 ? 1 : days.length <= 31 ? 5 : 15;
  // The tapped day, else the latest day with anything in it, else the last day.
  const focus = days.find((d) => d.day === hover) ?? days[days.length - 1];
  const total = days.reduce((sum, d) => sum + pick(d), 0);
  const showCounts = days.length <= 14;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="text-xs text-muted">
          <b className="tabular-nums text-ink">{total.toLocaleString()}</b> in {days.length} days
        </p>
      </div>

      <div className="flex gap-2">
        <div className="relative h-36 w-7 flex-shrink-0 text-right text-[10px] tabular-nums text-muted" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ bottom: `${(t / top) * 100}%` }}>
              {t}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-36">
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t border-border" style={{ bottom: `${(t / top) * 100}%` }} aria-hidden />
            ))}
            <div className="absolute inset-0 flex items-end gap-px" onMouseLeave={() => setHover(null)}>
              {days.map((d) => {
                const v = pick(d);
                const active = focus?.day === d.day;
                return (
                  <button
                    key={d.day}
                    type="button"
                    aria-label={`${longDay(d.day)}: ${v} ${unit}`}
                    onMouseEnter={() => setHover(d.day)}
                    onClick={() => setHover(d.day)}
                    className="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
                  >
                    {showCounts && v > 0 && (
                      <span className="mb-0.5 text-center text-[10px] font-medium tabular-nums text-muted">{v}</span>
                    )}
                    <span
                      className={`block w-full rounded-t-[3px] transition-opacity ${color} ${active ? "opacity-100" : "opacity-60 group-hover:opacity-90"}`}
                      style={{ height: `${v > 0 ? Math.max((v / top) * 100, 2) : 0}%` }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-1 flex gap-px text-[10px] text-muted" aria-hidden>
            {days.map((d, i) => (
              <span key={d.day} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">
                {i % labelEvery === 0 || i === days.length - 1 ? shortDay(d.day) : ""}
              </span>
            ))}
          </div>
        </div>
      </div>

      {focus && (
        <p className="mt-2 rounded-lg bg-subtle px-3 py-1.5 text-xs text-muted">
          <b className="text-ink">{longDay(focus.day)}</b> — <b className="tabular-nums text-ink">{pick(focus).toLocaleString()}</b> {unit}
          {secondary ? ` · ${secondary(focus)}` : ""}
        </p>
      )}
    </div>
  );
}

export function TrafficCharts() {
  const [range, setRange] = useState<(typeof RANGES)[number]>(14);
  const { data: days, error } = useSWR(["dashboard_daily", range], () => fetchDaily(range), {
    keepPreviousData: true,
    revalidateOnFocus: true,
  });

  return (
    <section className="card space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Traffic & sign-ups</h2>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button key={r} type="button" onClick={() => setRange(r)} className={range === r ? "btn-primary" : "btn-secondary"}>
                {r}d
              </button>
            ))}
          </div>
          <Link href="/analytics" className="flex items-center text-xs font-medium text-accent hover:underline">
            Full analytics <ChevronRight size={13} />
          </Link>
        </div>
      </div>

      {error && <p className="text-sm text-danger">Couldn&apos;t load the graphs: {error.message}</p>}
      {!days && !error && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="h-48 animate-pulse rounded-lg bg-ink/5" />
          <div className="h-48 animate-pulse rounded-lg bg-ink/5" />
        </div>
      )}
      {days && (
        <div className="grid gap-6 lg:grid-cols-2">
          <BarChart
            title="Website visitors per day"
            days={days}
            pick={(d) => d.visitors}
            unit="visitors"
            color="bg-accent"
            secondary={(d) => `${d.pageviews.toLocaleString()} page views`}
          />
          <BarChart
            title="New sign-ups per day"
            days={days}
            pick={(d) => d.signups}
            unit="sign-ups"
            color="bg-emerald-500"
            secondary={(d) => `${d.paid} ${d.paid === 1 ? "payment" : "payments"}`}
          />
        </div>
      )}
    </section>
  );
}
