"use client";

import {
  Users,
  UserPlus,
  Activity,
  CreditCard,
  Video,
  Clock,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  Download,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";
import { PageLoading } from "@/components/PageLoading";

interface DashboardStats {
  totalUsers: number;
  freeUsers: number;
  paidUsers: number;
  activeSubscriptions: number;
  expiredSubscriptions: number;
  totalMinutesPurchased: number;
  totalMinutesConsumed: number;
  totalMinutesRemaining: number;
  totalInterviews: number;
  interviewsToday: number;
  interviewsThisWeek: number;
  interviewsThisMonth: number;
  totalTranscripts: number;
  totalAiTokens: number;
  estimatedAiCostUsd: number;
  failedSessions: number;
  suspiciousAccounts: number;
  signupsToday: number;
  signupsThisWeek: number;
  signupsThisMonth: number;
  activeUsers7d: number;
  usersNeverInterviewed: number;
  devices: {
    desktopUsers: number;
    desktopWindows: number;
    desktopMac: number;
    browserUsers: number;
    phoneUsers: number;
    androidUsers: number;
    iosUsers: number;
    computerBrowserUsers: number;
    websiteOnlyUsers: number;
  };
  // Null when GitHub couldn't be reached.
  downloads: {
    windowsInstaller: number;
    windowsUpdates: number;
    mac: number;
    latestVersion: string | null;
    latestVersionDownloads: number;
  } | null;
}

function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%";
}

// A headline figure with an icon.
function Tile({ icon: Icon, label, value, sub }: { icon: LucideIcon; label: string; value: string | number; sub?: string }) {
  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center gap-2 text-muted">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Icon size={16} strokeWidth={2.2} />
        </span>
        <span className="text-xs font-medium leading-tight">{label}</span>
      </div>
      <div>
        <p className="text-2xl font-semibold tabular-nums text-ink">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
    </div>
  );
}

// One measure as horizontal bars in a single colour, with each value written
// beside its bar (one series, so no legend). Widths are relative to `max`.
function Bars({ rows, max }: { rows: { label: string; value: number; note?: string }[]; max: number }) {
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${r.value}${r.note ? ` (${r.note})` : ""}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="text-ink">{r.label}</span>
            <span className="tabular-nums text-ink">
              <span className="font-semibold">{r.value.toLocaleString()}</span>
              {r.note && <span className="ml-1.5 text-xs text-muted">{r.note}</span>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink/[0.06]">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${max > 0 ? Math.max((r.value / max) * 100, r.value > 0 ? 2 : 0) : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {aside && <span className="text-xs text-muted">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function MiniStats({ items, onColor = false }: { items: { label: string; value: number }[]; onColor?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      {items.map((x) => (
        <div key={x.label} className={`rounded-xl px-2 py-2.5 ${onColor ? "bg-white/15" : "bg-subtle"}`}>
          <p className={`text-lg font-semibold tabular-nums ${onColor ? "" : "text-ink"}`}>{x.value.toLocaleString()}</p>
          <p className={`text-[11px] ${onColor ? "text-white/80" : "text-muted"}`}>{x.label}</p>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { data: stats, error } = useAdminQuery<DashboardStats>("admin-dashboard-stats");

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;
  if (!stats) return <PageLoading error={error} />;

  const now = new Date();
  const interviewed = stats.totalUsers - stats.usersNeverInterviewed;
  const d = stats.devices;
  const deviceRows = [
    { label: "Desktop app · Windows", value: d.desktopWindows },
    { label: "Desktop app · Mac", value: d.desktopMac },
    { label: "Phone · Android", value: d.androidUsers },
    { label: "Phone · iPhone", value: d.iosUsers },
    { label: "Browser on a computer", value: d.computerBrowserUsers },
    { label: "Website only", value: d.websiteOnlyUsers },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <p className="text-sm text-muted">
          {now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
        </p>
        <h1 className="text-xl font-semibold text-ink">{greeting(now)} 👋</h1>
      </div>

      {/* Headline: how many people, and how many joined recently. */}
      <section className="rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 p-5 text-white shadow-card">
        <p className="text-sm text-white/80">Total users</p>
        <p className="mt-1 text-4xl font-semibold tabular-nums">{stats.totalUsers.toLocaleString()}</p>
        <p className="mt-1 text-sm text-white/85">
          +{stats.signupsToday} today · +{stats.signupsThisWeek} this week · +{stats.signupsThisMonth} this month
        </p>
        <div className="mt-4">
          <MiniStats
            onColor
            items={[
              { label: "Paid", value: stats.paidUsers },
              { label: "Free", value: stats.freeUsers },
              { label: "Active 7 days", value: stats.activeUsers7d },
            ]}
          />
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={UserPlus} label="Sign-ups today" value={stats.signupsToday} sub={`${stats.signupsThisWeek} this week`} />
        <Tile icon={Video} label="Interviews today" value={stats.interviewsToday} sub={`${stats.interviewsThisWeek} this week`} />
        <Tile
          icon={Clock}
          label="Minutes used"
          value={Math.round(stats.totalMinutesConsumed).toLocaleString()}
          sub={`${Math.round(stats.totalMinutesRemaining).toLocaleString()} still unused`}
        />
        <Tile
          icon={Sparkles}
          label="AI cost"
          value={`$${stats.estimatedAiCostUsd.toFixed(2)}`}
          sub={`${(stats.totalAiTokens / 1_000_000).toFixed(1)}M tokens`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="From sign-up to paid" aside="share of all users">
          <Bars
            max={stats.totalUsers}
            rows={[
              { label: "Signed up", value: stats.totalUsers },
              { label: "Did an interview", value: interviewed, note: pct(interviewed, stats.totalUsers) },
              { label: "Paid", value: stats.paidUsers, note: pct(stats.paidUsers, stats.totalUsers) },
            ]}
          />
        </Section>

        <Section title="Where people use Smallbird" aside="users">
          <Bars rows={deviceRows} max={Math.max(...deviceRows.map((r) => r.value), 1)} />
          <p className="mt-4 text-xs text-muted">Desktop use is counted from each user&apos;s next sign-in or interview.</p>
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Interviews" aside={`${stats.totalInterviews.toLocaleString()} in total`}>
          <MiniStats
            items={[
              { label: "Today", value: stats.interviewsToday },
              { label: "This week", value: stats.interviewsThisWeek },
              { label: "This month", value: stats.interviewsThisMonth },
            ]}
          />
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted">Transcripts saved</span>
              <span className="font-semibold tabular-nums text-ink">{stats.totalTranscripts.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Ended early or timed out</span>
              <span className="font-semibold tabular-nums text-ink">{stats.failedSessions.toLocaleString()}</span>
            </div>
          </div>
        </Section>

        <Section title="Downloads" aside="from GitHub releases">
          {stats.downloads ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Download size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">Windows installer</p>
                  <p className="text-xs text-muted">From the website&apos;s download button</p>
                </div>
                <span className="text-lg font-semibold tabular-nums text-ink">{stats.downloads.windowsInstaller}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <RefreshCw size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">Auto-updates</p>
                  <p className="text-xs text-muted">
                    Latest {stats.downloads.latestVersion ?? "--"}: {stats.downloads.latestVersionDownloads}
                  </p>
                </div>
                <span className="text-lg font-semibold tabular-nums text-ink">{stats.downloads.windowsUpdates}</span>
              </div>
              <p className="text-xs text-muted">Downloads are anonymous, so these are totals, not per user.</p>
            </div>
          ) : (
            <p className="text-sm text-muted">Couldn&apos;t reach GitHub just now.</p>
          )}
        </Section>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={CreditCard} label="Active subscriptions" value={stats.activeSubscriptions} sub={`${stats.expiredSubscriptions} ended`} />
        <Tile
          icon={Users}
          label="Never did an interview"
          value={stats.usersNeverInterviewed}
          sub={`${pct(stats.usersNeverInterviewed, stats.totalUsers)} of users`}
        />
        <Tile icon={Activity} label="Minutes bought" value={Math.round(stats.totalMinutesPurchased).toLocaleString()} />
        {/* A status, so it carries an icon and words, not colour alone. */}
        <div className="card flex flex-col gap-3">
          <div className="flex items-center gap-2 text-muted">
            <span
              className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
                stats.suspiciousAccounts > 0 ? "bg-danger/10 text-danger" : "bg-ok/10 text-ok"
              }`}
            >
              {stats.suspiciousAccounts > 0 ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />}
            </span>
            <span className="text-xs font-medium leading-tight">Suspicious accounts</span>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums text-ink">{stats.suspiciousAccounts}</p>
            <p className="mt-0.5 text-xs text-muted">{stats.suspiciousAccounts > 0 ? "Needs a look" : "All clear"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
