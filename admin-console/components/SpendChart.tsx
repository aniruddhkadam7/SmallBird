"use client";

// Daily spend chart for the AI usage page's OpenAI and Deepgram cards, in
// the same style as the Resume Builder page's daily chart: a rupee y axis
// with gridlines, every day of the range (days with no spend show as empty),
// date labels, and a detail box with the hovered / tapped / latest day's
// cost and what happened that day. The whole column is the hover/tap
// target, so short bars are easy to hit.

import { useState } from "react";

export interface SpendDay {
  date: string; // YYYY-MM-DD, UTC
  usd: number;
}

interface Props<D extends SpendDay> {
  days: D[];
  usdToInr: number;
  // One line of "what happened" for a day, e.g. "185 AI calls · 3 people".
  describe: (day: D) => React.ReactNode;
  rangeDays?: number;
}

const inr = (n: number, digits = 2) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

const shortDay = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

const longDay = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/// A round axis top (in rupees) at or above max, and 3 evenly spaced ticks.
function axis(maxInr: number) {
  if (maxInr <= 0) return { top: 1, ticks: [0, 0.5, 1] };
  const magnitude = 10 ** Math.floor(Math.log10(maxInr));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s * 2 >= maxInr) ?? 10 * magnitude;
  return { top: step * 2, ticks: [0, step, step * 2] };
}

export function SpendChart<D extends SpendDay>({ days: raw, usdToInr, describe, rangeDays = 30 }: Props<D>) {
  const [hover, setHover] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  // Every day of the range, oldest first; a day missing from the data spent 0.
  const byDate = new Map(raw.map((d) => [d.date, d]));
  const todayKey = new Date().toISOString().slice(0, 10);
  const days = Array.from({ length: rangeDays }, (_, i) => {
    const date = new Date(Date.parse(`${todayKey}T00:00:00Z`) - (rangeDays - 1 - i) * 86400_000).toISOString().slice(0, 10);
    return byDate.get(date) ?? ({ date, usd: 0 } as D);
  });

  const values = days.map((d) => d.usd * usdToInr);
  const { top, ticks } = axis(Math.max(...values));
  const labelEvery = days.length <= 10 ? 1 : days.length <= 20 ? 3 : 5;

  const total = days.reduce((s, d) => s + d.usd, 0);
  const activeDays = days.filter((d) => d.usd > 0).length;
  const busiest = days.reduce((a, b) => (b.usd > a.usd ? b : a), days[0]);
  const focusDate = hover ?? picked;
  const focus =
    days.find((d) => d.date === focusDate) ?? [...days].reverse().find((d) => d.usd > 0) ?? days[days.length - 1];

  return (
    <div>
      <div className="flex gap-2">
        {/* Y axis, in rupees */}
        <div className="relative h-40 w-12 flex-shrink-0 text-right text-[10px] tabular-nums text-muted">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - (t / top) * 100}%` }}>
              {inr(t, t < 10 && t % 1 !== 0 ? 1 : 0)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-40">
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute inset-x-0 border-t border-dashed border-border"
                style={{ top: `${100 - (t / top) * 100}%` }}
              />
            ))}
            <div className="relative flex h-full items-end gap-px sm:gap-[3px]" onMouseLeave={() => setHover(null)}>
              {days.map((d, i) => {
                const active = focus?.date === d.date && (hover || picked);
                return (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => setPicked(picked === d.date ? null : d.date)}
                    onMouseEnter={() => setHover(d.date)}
                    className="group relative flex h-full flex-1 flex-col items-center justify-end"
                    aria-label={`${longDay(d.date)}: ${inr(values[i])}`}
                  >
                    <span
                      className={`block w-full max-w-8 rounded-t transition-colors ${
                        active ? "bg-accent" : "bg-accent/60 group-hover:bg-accent"
                      }`}
                      style={{ height: `${d.usd > 0 ? Math.max((values[i] / top) * 100, 2) : 0}%` }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
          {/* X axis. Labels sit centred under their bar and may be wider than
              it (a phone's 30 columns are ~8px each); counting back from today
              keeps "Today" labelled and stops labels from overlapping. Phones
              get one a week, wider screens one every labelEvery days. */}
          <div className="relative mt-1 h-4 border-t border-border">
            {days.map((d, i) => {
              const fromEnd = days.length - 1 - i;
              const onPhone = fromEnd % 7 === 0;
              const onWide = fromEnd % labelEvery === 0;
              if (!onPhone && !onWide) return null;
              return (
                <span
                  key={d.date}
                  className={`absolute top-1 -translate-x-1/2 whitespace-nowrap text-[10px] text-muted ${
                    onPhone ? (onWide ? "" : "sm:hidden") : "hidden sm:block"
                  }`}
                  style={{ left: `${((i + 0.5) / days.length) * 100}%` }}
                >
                  {d.date === todayKey ? "Today" : shortDay(d.date)}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {focus && (
        <div className="mt-3 rounded-lg bg-subtle px-3 py-2 text-sm">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-ink">{focus.date === todayKey ? "Today" : longDay(focus.date)}</span>
            <span className="font-semibold text-ink">{inr(focus.usd * usdToInr)}</span>
            <span className="text-xs text-muted">(${focus.usd.toFixed(4)})</span>
          </p>
          <p className="mt-0.5 text-xs text-muted">{focus.usd > 0 ? describe(focus) : "Nothing spent this day."}</p>
        </div>
      )}

      <p className="mt-2 text-[11px] text-muted">
        Last {rangeDays} days (UTC): <span className="font-medium text-ink">{inr(total * usdToInr)}</span> (${total.toFixed(2)})
        {" "}over {activeDays} day{activeDays === 1 ? "" : "s"} with spend
        {activeDays > 0 && (
          <>
            {" "}· average {inr((total / activeDays) * usdToInr)} on those days · busiest {shortDay(busiest.date)} (
            {inr(busiest.usd * usdToInr)})
          </>
        )}
        . Hover or tap a bar for that day.
      </p>
    </div>
  );
}
