"use client";

import { useState } from "react";
import useSWR from "swr";
import { ArrowDownRight, ArrowUpRight, Lightbulb, TriangleAlert, ThumbsUp } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Unauthorized } from "@/components/Unauthorized";
import { PageLoading } from "@/components/PageLoading";
import { formatRupees } from "@/lib/format";

// Website traffic: how many people visit, where they come from, what they
// look at, and which of those sources and pages turn into sign-ups, app use
// and payments -- plus plain-English pointers on what's working and what
// isn't. Data: web_events, recorded by the website's tracker through the
// `track` Edge Function, read with admin_web_analytics (migration 0063).
// A sign-up or payment is credited to the channel that first brought that
// person to the site (first touch).

interface Row {
  visitors: number;
  sessions: number;
  bounceRate: number;
  avgSessionSec: number;
  signups: number;
  paid: number;
}

interface Analytics {
  days: number;
  trackingSince: string | null;
  totals: {
    visitors: number;
    newVisitors: number;
    sessions: number;
    pageviews: number;
    avgSessionSec: number;
    pagesPerSession: number;
    bounceRate: number;
    signups: number;
    signupsTracked: number;
    usedApp: number;
    paidUsers: number;
    revenuePaise: number;
    downloadClicks: number;
    buyClicks: number;
  };
  previous: { visitors: number; sessions: number; pageviews: number; signups: number };
  daily: { day: string; visitors: number; pageviews: number; signups: number; paid: number }[];
  channels: (Row & { channel: string; revenuePaise: number })[];
  sources: (Omit<Row, "avgSessionSec"> & { source: string; channel: string | null })[];
  campaigns: { campaign: string; sessions: number; visitors: number; signups: number }[];
  landingPages: (Row & { path: string })[];
  pages: { path: string; views: number; visitors: number; avgSec: number; exits: number }[];
  countries: { name: string; visitors: number; signups: number }[];
  cities: { name: string; visitors: number }[];
  devices: { name: string; visitors: number; bounceRate: number; signups: number }[];
  browsers: { name: string; visitors: number }[];
  os: { name: string; visitors: number }[];
  events: { name: string; count: number; visitors: number }[];
  hours: { hour: number; pageviews: number }[];
  funnel: {
    visitors: number;
    sawPricing: number;
    sawDownload: number;
    clickedDownloadOrBuy: number;
    signedUp: number;
    usedApp: number;
    paid: number;
  };
}

async function fetchAnalytics(days: number): Promise<Analytics> {
  const { data, error } = await createClient().rpc("admin_web_analytics", { p_days: days });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data as Analytics;
}

const RANGES = [7, 30, 90] as const;

// Vercel gives ISO country codes ("IN"); show the name.
const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();
const countryName = (code: string) => (/^[A-Z]{2}$/.test(code) ? (regionNames?.of(code) ?? code) : code);
const placeName = (name: string) => name.replace(/, ([A-Z]{2})$/, (_, c: string) => `, ${countryName(c)}`);

const pct = (part: number, whole: number) => (whole > 0 ? (100 * part) / whole : 0);
const fmtPct = (n: number) => `${n >= 10 || n === 0 ? Math.round(n) : n.toFixed(1)}%`;
const shortDay = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

function fmtDuration(sec: number) {
  if (!sec) return "0s";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}

const EVENT_LABELS: Record<string, string> = {
  download_windows: "Clicked download (Windows)",
  download_mac: "Clicked download (Mac)",
  checkout_open: "Opened payment",
  checkout_closed: "Closed payment without paying",
  payment_success: "Paid",
};

function eventLabel(name: string) {
  if (EVENT_LABELS[name]) return EVENT_LABELS[name];
  if (name.startsWith("buy_start_")) return `Clicked buy · ${name.slice(10).replace(/[-_]/g, " ")}`;
  return name.replace(/_/g, " ");
}

// ---- Insights -------------------------------------------------------------
// Rules over the numbers above, each only when there's enough data to mean
// something, so the page says in words what to keep doing and what to fix.

type Insight = { tone: "good" | "bad" | "idea"; text: string };

function insights(a: Analytics): Insight[] {
  const out: Insight[] = [];
  const t = a.totals;
  if (t.visitors < 20) {
    out.push({ tone: "idea", text: "Not much traffic yet in this range. Insights get sharper after a few hundred visitors." });
  }

  const visitorChange = pct(t.visitors - a.previous.visitors, a.previous.visitors);
  if (a.previous.visitors >= 20 && Math.abs(visitorChange) >= 15) {
    out.push({
      tone: visitorChange > 0 ? "good" : "bad",
      text: `Visitors are ${visitorChange > 0 ? "up" : "down"} ${fmtPct(Math.abs(visitorChange))} on the previous ${a.days} days.`,
    });
  }

  const ch = a.channels.filter((c) => c.channel !== "Not tracked" && c.sessions >= 10);
  const withRate = ch.map((c) => ({ ...c, rate: pct(c.signups, c.visitors) }));
  const best = [...withRate].sort((x, y) => y.rate - x.rate)[0];
  const biggest = [...withRate].sort((x, y) => y.visitors - x.visitors)[0];
  if (best && best.signups > 0) {
    out.push({
      tone: "good",
      text: `${best.channel} converts best: ${fmtPct(best.rate)} of its visitors sign up. Put more effort into ${best.channel.toLowerCase()}.`,
    });
  }
  if (biggest && best && biggest.channel !== best.channel && biggest.rate < best.rate / 2) {
    out.push({
      tone: "bad",
      text: `${biggest.channel} brings the most visitors but only ${fmtPct(biggest.rate)} sign up. The pages they land on may not match what they were looking for.`,
    });
  }
  const highBounce = withRate.filter((c) => c.bounceRate >= 75);
  for (const c of highBounce.slice(0, 2)) {
    out.push({ tone: "bad", text: `${fmtPct(c.bounceRate)} of ${c.channel} visits leave after one page. Check the first page they see.` });
  }

  const lps = a.landingPages.filter((l) => l.sessions >= 10);
  const bestLp = [...lps].sort((x, y) => pct(y.signups, y.visitors) - pct(x.signups, x.visitors))[0];
  if (bestLp && bestLp.signups > 0) {
    out.push({
      tone: "good",
      text: `${bestLp.path} is the best landing page: ${fmtPct(pct(bestLp.signups, bestLp.visitors))} of visitors who start there sign up. Send ads and links there.`,
    });
  }
  const worstLp = [...lps].sort((x, y) => y.bounceRate - x.bounceRate)[0];
  if (worstLp && worstLp.bounceRate >= 70 && worstLp.path !== bestLp?.path) {
    out.push({
      tone: "bad",
      text: `${worstLp.path} loses ${fmtPct(worstLp.bounceRate)} of visitors after one page. Make its first screen clearer and add a sign-up button.`,
    });
  }

  const mobile = a.devices.find((d) => d.name === "mobile");
  const desktop = a.devices.find((d) => d.name === "desktop");
  if (mobile && desktop && mobile.visitors >= 20 && desktop.visitors >= 20) {
    const mr = pct(mobile.signups, mobile.visitors);
    const dr = pct(desktop.signups, desktop.visitors);
    const share = pct(mobile.visitors, mobile.visitors + desktop.visitors);
    if (share >= 40 && mr < dr / 2) {
      out.push({
        tone: "bad",
        text: `${fmtPct(share)} of visitors are on phones but they sign up ${dr > 0 ? `${(dr / Math.max(mr, 0.1)).toFixed(1)}×` : "much"} less than on computers. The app is for Windows, so tell phone visitors to sign up now and download on a laptop.`,
      });
    }
  }

  const f = a.funnel;
  if (f.sawPricing >= 10 && f.clickedDownloadOrBuy < f.sawPricing * 0.1) {
    out.push({
      tone: "bad",
      text: `${f.sawPricing} visitors saw the pricing page but only ${f.clickedDownloadOrBuy} clicked download or buy. Pricing may feel high or unclear; try a clearer free-trial message there.`,
    });
  }
  const opened = a.events.find((e) => e.name === "checkout_open")?.visitors ?? 0;
  const closed = a.events.find((e) => e.name === "checkout_closed")?.visitors ?? 0;
  if (opened >= 5 && closed >= opened * 0.5) {
    out.push({
      tone: "bad",
      text: `${closed} of ${opened} people who opened the payment window closed it without paying. Check payment methods (UPI) and whether the price shown matches what they expected.`,
    });
  }
  if (f.signedUp >= 10 && f.usedApp < f.signedUp * 0.3) {
    out.push({
      tone: "bad",
      text: `Only ${f.usedApp} of ${f.signedUp} new sign-ups started an interview. Improve the steps after sign-up: the download, install and first session.`,
    });
  }

  const busiest = [...a.hours].sort((x, y) => y.pageviews - x.pageviews)[0];
  if (busiest && busiest.pageviews >= 20) {
    out.push({
      tone: "idea",
      text: `Most traffic comes around ${busiest.hour % 12 || 12} ${busiest.hour < 12 ? "am" : "pm"} (India time). Post on social media and send emails just before then.`,
    });
  }

  const untracked = t.signups - t.signupsTracked;
  if (t.signups > 0 && untracked > t.signups / 2) {
    out.push({
      tone: "idea",
      text: `${untracked} of ${t.signups} sign-ups can't be traced to a source (they came before tracking started, or straight from the desktop app). This gets better as new visitors arrive.`,
    });
  }
  if (!a.campaigns.length && t.visitors >= 20) {
    out.push({
      tone: "idea",
      text: "No campaign links yet. Add ?utm_source=instagram&utm_campaign=<name> to links you share, so each post or ad shows up here separately.",
    });
  }
  return out;
}

// ---- Pieces ----------------------------------------------------------------

function Change({ now, before }: { now: number; before: number }) {
  if (!before) return null;
  const change = pct(now - before, before);
  if (Math.abs(change) < 1) return <span className="text-xs text-muted">same as before</span>;
  const up = change > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center text-xs font-medium ${up ? "text-ok" : "text-danger"}`}>
      <Icon size={13} />
      {fmtPct(Math.abs(change))}
    </span>
  );
}

function Tile({ label, value, sub, change }: { label: string; value: string | number; sub?: string; change?: React.ReactNode }) {
  return (
    <div className="card">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 flex items-baseline gap-2 text-2xl font-semibold tabular-nums text-ink">
        {typeof value === "number" ? value.toLocaleString("en-IN") : value}
        {change}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card min-w-0">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

// Visitors per day with sign-ups marked, same style as the Resume Builder
// chart: counts on bars, gridlines, date labels and a detail line for the
// hovered / latest day.
function DailyChart({ daily }: { daily: Analytics["daily"] }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...daily.map((d) => d.visitors));
  const top = max <= 4 ? max : Math.ceil(max / 4) * 4;
  const ticks = top <= 4 ? Array.from({ length: top + 1 }, (_, i) => i) : [0, top / 4, top / 2, (3 * top) / 4, top];
  const labelEvery = daily.length <= 10 ? 1 : daily.length <= 31 ? 5 : 15;
  const focus = daily.find((d) => d.day === hover) ?? [...daily].reverse().find((d) => d.visitors > 0) ?? daily[daily.length - 1];
  const showCounts = daily.length <= 31;

  return (
    <div>
      <div className="flex gap-2">
        <div className="relative h-40 w-7 flex-shrink-0 text-right text-[10px] tabular-nums text-muted">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - (t / top) * 100}%` }}>
              {t}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-40">
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t border-dashed border-border" style={{ top: `${100 - (t / top) * 100}%` }} />
            ))}
            <div className="relative flex h-full items-end gap-px sm:gap-0.5" onMouseLeave={() => setHover(null)}>
              {daily.map((d) => (
                <div
                  key={d.day}
                  onMouseEnter={() => setHover(d.day)}
                  onClick={() => setHover(d.day)}
                  className="group relative flex h-full flex-1 flex-col items-center justify-end"
                >
                  {showCounts && d.visitors > 0 && (
                    <span className="mb-0.5 hidden text-[9px] font-semibold tabular-nums text-ink sm:block">{d.visitors}</span>
                  )}
                  <span
                    className={`relative block w-full max-w-8 rounded-t transition-colors ${
                      focus?.day === d.day && hover ? "bg-accent" : "bg-accent/70 group-hover:bg-accent"
                    }`}
                    style={{ height: `${d.visitors ? Math.max((d.visitors / top) * 100, 2) : 0}%` }}
                  >
                    {d.signups > 0 && (
                      <span
                        className="absolute -top-1.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-surface bg-ok"
                        title={`${d.signups} sign-ups`}
                      />
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1 flex gap-px border-t border-border pt-1 sm:gap-0.5">
            {daily.map((d, i) => (
              <span key={d.day} className="flex-1 overflow-visible whitespace-nowrap text-center text-[10px] text-muted">
                {i % labelEvery === 0 ? shortDay(d.day) : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent/70" /> Visitors
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-ok" /> Day with sign-ups
        </span>
      </div>
      {focus && (
        <div className="mt-2 rounded-lg bg-subtle px-3 py-2 text-sm">
          <p className="font-medium text-ink">
            {new Date(`${focus.day}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
          </p>
          <p className="text-xs text-muted">
            <b className="text-ink">{focus.visitors}</b> visitors · <b className="text-ink">{focus.pageviews}</b> page views ·{" "}
            <b className="text-ink">{focus.signups}</b> sign-ups · <b className="text-ink">{focus.paid}</b> payments
          </p>
        </div>
      )}
    </div>
  );
}

// A ranked list with a bar per row: label, main number, and extra columns.
function BarList<T>({
  rows,
  label,
  value,
  extra,
  empty = "No data yet.",
}: {
  rows: T[];
  label: (r: T) => React.ReactNode;
  value: (r: T) => number;
  extra?: (r: T) => React.ReactNode;
  empty?: string;
}) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  const max = Math.max(1, ...rows.map(value));
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={i}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink">{label(r)}</span>
            <span className="flex flex-shrink-0 items-baseline gap-2 tabular-nums">
              {extra && <span className="text-xs text-muted">{extra(r)}</span>}
              <span className="font-semibold text-ink">{value(r).toLocaleString("en-IN")}</span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(value(r) / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// A table that scrolls sideways inside its card on phones.
function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length) return <p className="text-sm text-muted">No data yet.</p>;
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            {head.map((h, i) => (
              <th key={h} className={`py-2 pr-3 font-medium ${i > 0 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              {r.map((c, j) => (
                <td key={j} className={`py-2 pr-3 ${j > 0 ? "text-right tabular-nums" : "max-w-[220px] truncate text-ink"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rate({ part, whole }: { part: number; whole: number }) {
  if (!whole) return <span className="text-muted">–</span>;
  const r = pct(part, whole);
  return <span className={r >= 5 ? "font-medium text-ok" : r === 0 ? "text-muted" : "text-ink"}>{fmtPct(r)}</span>;
}

function Funnel({ f }: { f: Analytics["funnel"] }) {
  const steps = [
    { label: "Visited the site", n: f.visitors },
    { label: "Looked at pricing", n: f.sawPricing },
    { label: "Opened the download page", n: f.sawDownload },
    { label: "Clicked download or buy", n: f.clickedDownloadOrBuy },
    { label: "Signed up", n: f.signedUp },
    { label: "Started an interview in the app", n: f.usedApp },
    { label: "Paid", n: f.paid },
  ];
  const max = Math.max(1, f.visitors, f.signedUp);
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => {
        const prevN = i > 0 ? steps[i - 1].n : 0;
        return (
          <li key={s.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="text-ink">{s.label}</span>
              <span className="flex items-baseline gap-2 tabular-nums">
                {i > 0 && prevN > 0 && <span className="text-xs text-muted">{fmtPct(pct(s.n, prevN))} of above</span>}
                <span className="font-semibold text-ink">{s.n.toLocaleString("en-IN")}</span>
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-ink/[0.06]">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max((s.n / max) * 100, s.n ? 1 : 0)}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const INSIGHT_STYLE = {
  good: { icon: ThumbsUp, cls: "bg-ok/10 text-ok" },
  bad: { icon: TriangleAlert, cls: "bg-danger/10 text-danger" },
  idea: { icon: Lightbulb, cls: "bg-accent/10 text-accent" },
};

// ---- Page ------------------------------------------------------------------

export default function AnalyticsPage() {
  const [days, setDays] = useState<number>(30);
  const { data: a, error } = useSWR(["admin_web_analytics", days], () => fetchAnalytics(days), { keepPreviousData: true });

  if ((error as { code?: string } | undefined)?.code === "42501") return <Unauthorized />;
  if (!a) return <PageLoading error={error} />;

  const t = a.totals;
  const tips = insights(a);
  const trackedDays = a.trackingSince ? Math.ceil((Date.now() - new Date(a.trackingSince).getTime()) / 86_400_000) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Analytics</h1>
          <p className="text-sm text-muted">Website traffic: where visitors come from, what they do, and what turns them into customers.</p>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setDays(r)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${days === r ? "bg-accent text-white" : "text-muted hover:text-ink"}`}
            >
              {r} days
            </button>
          ))}
        </div>
      </div>

      {!a.trackingSince ? (
        <div className="card text-sm text-muted">
          No website visits recorded yet. Tracking starts once the website with the new tracker is live; numbers appear here a few
          minutes after the first visitors arrive. Sign-ups and payments below already count.
        </div>
      ) : (
        trackedDays < days && (
          <p className="rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
            Tracking started {new Date(a.trackingSince).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, so visitor numbers
            only cover the last {trackedDays} {trackedDays === 1 ? "day" : "days"}.
          </p>
        )
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Visitors"
          value={t.visitors}
          sub={`${t.newVisitors.toLocaleString("en-IN")} new · ${t.sessions.toLocaleString("en-IN")} visits`}
          change={<Change now={t.visitors} before={a.previous.visitors} />}
        />
        <Tile
          label="Page views"
          value={t.pageviews}
          sub={`${t.pagesPerSession} pages per visit · ${fmtDuration(t.avgSessionSec)} avg visit`}
          change={<Change now={t.pageviews} before={a.previous.pageviews} />}
        />
        <Tile
          label="Sign-ups"
          value={t.signups}
          sub={`${fmtPct(pct(t.signupsTracked, t.visitors))} of visitors · ${t.usedApp} used the app`}
          change={<Change now={t.signups} before={a.previous.signups} />}
        />
        <Tile label="Paying customers" value={t.paidUsers} sub={`${formatRupees(t.revenuePaise)} · bounce ${fmtPct(t.bounceRate)}`} />
      </div>

      {tips.length > 0 && (
        <Section title="What's working, what's not" hint="Read from the numbers on this page. Each one names something to do.">
          <ul className="space-y-2">
            {tips.map((tip, i) => {
              const { icon: Icon, cls } = INSIGHT_STYLE[tip.tone];
              return (
                <li key={i} className="flex gap-2.5 text-sm text-ink">
                  <span className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${cls}`}>
                    <Icon size={13} />
                  </span>
                  <span>{tip.text}</span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section title="Visitors per day" hint="Bars are visitors; a green dot marks a day with sign-ups. Hover or tap a day for its numbers.">
        <DailyChart daily={a.daily} />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Where visitors come from" hint="Grouped by channel. Sign-ups and payments credited to the channel that first brought each person.">
          <Table
            head={["Channel", "Visitors", "Bounce", "Avg visit", "Sign-ups", "Sign-up rate", "Paid"]}
            rows={a.channels.map((c) => [
              c.channel,
              c.visitors,
              c.sessions ? fmtPct(c.bounceRate) : "–",
              c.sessions ? fmtDuration(c.avgSessionSec) : "–",
              c.signups,
              <Rate key="r" part={c.signups} whole={c.visitors} />,
              c.paid ? `${c.paid} · ${formatRupees(c.revenuePaise)}` : 0,
            ])}
          />
        </Section>
        <Section title="Path to paying" hint="How many people get through each step in this range.">
          <Funnel f={a.funnel} />
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Top sources" hint="The exact site or utm_source each visit started from.">
          <Table
            head={["Source", "Visits", "Bounce", "Sign-ups", "Rate"]}
            rows={a.sources.map((s) => [
              s.source,
              s.sessions,
              fmtPct(s.bounceRate),
              s.signups,
              <Rate key="r" part={s.signups} whole={s.visitors} />,
            ])}
          />
        </Section>
        <Section title="Campaigns" hint="Links shared with ?utm_campaign=… so each post or ad can be compared.">
          {a.campaigns.length ? (
            <Table
              head={["Campaign", "Visits", "Visitors", "Sign-ups"]}
              rows={a.campaigns.map((c) => [c.campaign, c.sessions, c.visitors, c.signups])}
            />
          ) : (
            <p className="text-sm text-muted">
              None yet. Share links like <code className="rounded bg-subtle px-1">smallbird.in/?utm_source=instagram&amp;utm_campaign=diwali</code> to see
              each one here.
            </p>
          )}
        </Section>
      </div>

      <Section title="Landing pages" hint="The first page of each visit. Low bounce and high sign-up rate = a page worth sending people to.">
        <Table
          head={["Page", "Visits", "Bounce", "Avg visit", "Sign-ups", "Sign-up rate", "Paid"]}
          rows={a.landingPages.map((l) => [
            l.path,
            l.sessions,
            fmtPct(l.bounceRate),
            fmtDuration(l.avgSessionSec),
            l.signups,
            <Rate key="r" part={l.signups} whole={l.visitors} />,
            l.paid,
          ])}
        />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Most viewed pages" hint="Exits: visits that ended on this page.">
          <Table
            head={["Page", "Views", "Visitors", "Avg time", "Exits"]}
            rows={a.pages.map((p) => [p.path, p.views, p.visitors, fmtDuration(p.avgSec), p.exits])}
          />
        </Section>
        <Section title="Key clicks" hint="Download and buy buttons, and what happened at payment.">
          <BarList
            rows={a.events}
            label={(e) => eventLabel(e.name)}
            value={(e) => e.count}
            extra={(e) => `${e.visitors} people`}
            empty="No clicks recorded yet."
          />
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Devices">
          <BarList
            rows={a.devices}
            label={(d) => d.name.charAt(0).toUpperCase() + d.name.slice(1)}
            value={(d) => d.visitors}
            extra={(d) => `bounce ${fmtPct(d.bounceRate)} · ${d.signups} sign-ups`}
          />
        </Section>
        <Section title="Browsers">
          <BarList rows={a.browsers} label={(b) => b.name} value={(b) => b.visitors} />
        </Section>
        <Section title="Operating systems" hint="Visitors on Windows or Mac can install the app right away.">
          <BarList rows={a.os} label={(o) => o.name} value={(o) => o.visitors} />
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Countries">
          <BarList rows={a.countries} label={(c) => countryName(c.name)} value={(c) => c.visitors} extra={(c) => (c.signups ? `${c.signups} sign-ups` : "")} />
        </Section>
        <Section title="Cities">
          <BarList rows={a.cities} label={(c) => placeName(c.name)} value={(c) => c.visitors} />
        </Section>
        <Section title="Busiest hours" hint="Page views by hour of day, India time.">
          <HoursChart hours={a.hours} />
        </Section>
      </div>
    </div>
  );
}

function HoursChart({ hours }: { hours: Analytics["hours"] }) {
  const max = Math.max(1, ...hours.map((h) => h.pageviews));
  return (
    <div>
      <div className="flex h-28 items-end gap-px">
        {hours.map((h) => (
          <div
            key={h.hour}
            className="flex-1 rounded-t bg-accent/70 hover:bg-accent"
            style={{ height: `${h.pageviews ? Math.max((h.pageviews / max) * 100, 3) : 0}%` }}
            title={`${h.hour}:00 – ${h.pageviews} page views`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>12 am</span>
        <span>6 am</span>
        <span>12 pm</span>
        <span>6 pm</span>
        <span>11 pm</span>
      </div>
    </div>
  );
}
