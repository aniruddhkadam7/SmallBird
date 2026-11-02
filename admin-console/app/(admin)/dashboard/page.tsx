"use client";

import Link from "next/link";
import {
  ChevronRight,
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
import { formatRupees } from "@/lib/format";

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
  // Money received (public.purchases), India-time periods.
  earnings: {
    totalPaise: number;
    totalCount: number;
    todayPaise: number;
    todayCount: number;
    weekPaise: number;
    weekCount: number;
    monthPaise: number;
    monthCount: number;
  };
  // Null when GitHub couldn't be reached.
  downloads: {
    windowsInstaller: number;
    windowsUpdates: number;
    mac: number;
    // Optional until the admin-dashboard-stats function with Mac update counts is deployed.
    macUpdates?: number;
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

// Every card on Home opens the page with the details behind it.
const TAPPABLE = "transition hover:border-accent/40 hover:shadow-md active:scale-[0.98]";

function CardLink({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  if (href.startsWith("http")) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={`${className} ${TAPPABLE}`}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={`${className} ${TAPPABLE}`}>
      {children}
    </Link>
  );
}

// A headline figure with an icon.
function Tile({
  icon: Icon,
  label,
  value,
  sub,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  sub?: string;
  href: string;
}) {
  return (
    <CardLink href={href} className="card flex flex-col gap-3">
      <div className="flex items-center gap-2 text-muted">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Icon size={16} strokeWidth={2.2} />
        </span>
        <span className="flex-1 text-xs font-medium leading-tight">{label}</span>
        <ChevronRight size={14} className="flex-shrink-0 text-muted/60" aria-hidden />
      </div>
      <div>
        <p className="text-2xl font-semibold tabular-nums text-ink">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
    </CardLink>
  );
}

// One measure as horizontal bars in a single colour, with each value written
// beside its bar (one series, so no legend). Widths are relative to `max`.
function Bars({ rows, max }: { rows: { label: string; value: number; note?: string; href: string }[]; max: number }) {
  return (
    <ul className="-mx-2 space-y-1">
      {rows.map((r) => (
        <li key={r.label}>
          <Link
            href={r.href}
            title={`${r.label}: ${r.value}${r.note ? ` (${r.note})` : ""}`}
            className="block rounded-lg px-2 py-1.5 transition-colors hover:bg-subtle active:bg-subtle"
          >
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="text-ink">{r.label}</span>
              <span className="flex items-center gap-1 tabular-nums text-ink">
                <span className="font-semibold">{r.value.toLocaleString()}</span>
                {r.note && <span className="ml-0.5 text-xs text-muted">{r.note}</span>}
                <ChevronRight size={13} className="text-muted/60" aria-hidden />
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-ink/[0.06]">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${max > 0 ? Math.max((r.value / max) * 100, r.value > 0 ? 2 : 0) : 0}%` }}
              />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, aside, href, children }: { title: string; aside?: string; href?: string; children: React.ReactNode }) {
  const header = (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <span className="flex items-center gap-1 text-xs text-muted">
        {aside}
        {href && <ChevronRight size={14} className="text-muted/60" aria-hidden />}
      </span>
    </div>
  );
  if (href) {
    return (
      <CardLink href={href} className="card block">
        {header}
        {children}
      </CardLink>
    );
  }
  // Its rows are the links.
  return (
    <section className="card">
      {header}
      {children}
    </section>
  );
}

function MiniStats({
  items,
  onColor = false,
}: {
  items: { label: string; value: number | string; href: string; sub?: string }[];
  onColor?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      {items.map((x) => (
        <Link
          key={x.label}
          href={x.href}
          className={`rounded-xl px-2 py-2.5 transition active:scale-[0.97] ${
            onColor ? "bg-white/15 hover:bg-white/25" : "bg-subtle hover:bg-ink/[0.06]"
          }`}
        >
          <p className={`text-lg font-semibold tabular-nums ${onColor ? "" : "text-ink"}`}>
            {typeof x.value === "number" ? x.value.toLocaleString() : x.value}
          </p>
          <p className={`text-[11px] ${onColor ? "text-white/80" : "text-muted"}`}>{x.label}</p>
          {x.sub && <p className={`text-[10px] ${onColor ? "text-white/70" : "text-muted"}`}>{x.sub}</p>}
        </Link>
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
    { label: "Desktop app · Windows", value: d.desktopWindows, href: "/users?segment=desktop_windows" },
    { label: "Desktop app · Mac", value: d.desktopMac, href: "/users?segment=desktop_mac" },
    { label: "Phone · Android", value: d.androidUsers, href: "/users?segment=android" },
    { label: "Phone · iPhone", value: d.iosUsers, href: "/users?segment=ios" },
    { label: "Browser on a computer", value: d.computerBrowserUsers, href: "/users?segment=computer_browser" },
    { label: "Website only", value: d.websiteOnlyUsers, href: "/users?segment=website_only" },
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
        <Link href="/users" className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-white/80">Total users</p>
            <p className="mt-1 text-4xl font-semibold tabular-nums">{stats.totalUsers.toLocaleString()}</p>
          </div>
          <ChevronRight size={20} className="mt-1 text-white/70" aria-hidden />
        </Link>
        <p className="mt-1 text-sm text-white/85">
          <Link href="/users?segment=joined_today" className="underline-offset-2 hover:underline">+{stats.signupsToday} today</Link>
          {" · "}
          <Link href="/users?segment=joined_week" className="underline-offset-2 hover:underline">+{stats.signupsThisWeek} this week</Link>
          {" · "}
          <Link href="/users?segment=joined_month" className="underline-offset-2 hover:underline">+{stats.signupsThisMonth} this month</Link>
        </p>
        <div className="mt-4">
          <MiniStats
            onColor
            items={[
              { label: "Paid", value: stats.paidUsers, href: "/users?plan=paid" },
              { label: "Free", value: stats.freeUsers, href: "/users?plan=free" },
              { label: "Active 7 days", value: stats.activeUsers7d, href: "/users?segment=active_7d" },
            ]}
          />
        </div>
      </section>

      {/* Money received. */}
      <section className="rounded-2xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600 p-5 text-white shadow-card">
        <Link href="/payments" className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-white/80">Total earnings</p>
            <p className="mt-1 text-4xl font-semibold tabular-nums">{formatRupees(stats.earnings.totalPaise)}</p>
            <p className="mt-1 text-sm text-white/85">
              from {stats.earnings.totalCount} payment{stats.earnings.totalCount === 1 ? "" : "s"}
            </p>
          </div>
          <ChevronRight size={20} className="mt-1 text-white/70" aria-hidden />
        </Link>
        <div className="mt-4">
          <MiniStats
            onColor
            items={[
              {
                label: "Today",
                value: formatRupees(stats.earnings.todayPaise),
                sub: `${stats.earnings.todayCount} paid`,
                href: "/payments?period=today",
              },
              {
                label: "This week",
                value: formatRupees(stats.earnings.weekPaise),
                sub: `${stats.earnings.weekCount} paid`,
                href: "/payments?period=week",
              },
              {
                label: "This month",
                value: formatRupees(stats.earnings.monthPaise),
                sub: `${stats.earnings.monthCount} paid`,
                href: "/payments?period=month",
              },
            ]}
          />
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={UserPlus} href="/users?segment=joined_today" label="Sign-ups today" value={stats.signupsToday} sub={`${stats.signupsThisWeek} this week`} />
        <Tile icon={Video} href="/sessions?period=today" label="Interviews today" value={stats.interviewsToday} sub={`${stats.interviewsThisWeek} this week`} />
        <Tile
          icon={Clock}
          href="/sessions"
          label="Minutes used"
          value={Math.round(stats.totalMinutesConsumed).toLocaleString()}
          sub={`${Math.round(stats.totalMinutesRemaining).toLocaleString()} still unused`}
        />
        <Tile
          icon={Sparkles}
          href="/ai-usage"
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
              { label: "Signed up", value: stats.totalUsers, href: "/users" },
              { label: "Did an interview", value: interviewed, note: pct(interviewed, stats.totalUsers), href: "/users?segment=interviewed" },
              { label: "Paid", value: stats.paidUsers, note: pct(stats.paidUsers, stats.totalUsers), href: "/users?plan=paid" },
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
              { label: "Today", value: stats.interviewsToday, href: "/sessions?period=today" },
              { label: "This week", value: stats.interviewsThisWeek, href: "/sessions?period=week" },
              { label: "This month", value: stats.interviewsThisMonth, href: "/sessions?period=month" },
            ]}
          />
          <div className="-mx-2 mt-3 text-sm">
            {[
              { label: "All interviews", value: stats.totalInterviews, href: "/sessions" },
              { label: "Transcripts saved", value: stats.totalTranscripts, href: "/transcripts" },
              { label: "Ended early or timed out", value: stats.failedSessions, href: "/sessions?status=failed" },
            ].map((x) => (
              <Link
                key={x.label}
                href={x.href}
                className="flex items-center justify-between rounded-lg px-2 py-2 transition-colors hover:bg-subtle active:bg-subtle"
              >
                <span className="text-muted">{x.label}</span>
                <span className="flex items-center gap-1 font-semibold tabular-nums text-ink">
                  {x.value.toLocaleString()}
                  <ChevronRight size={13} className="text-muted/60" aria-hidden />
                </span>
              </Link>
            ))}
          </div>
        </Section>

        <Section title="Downloads" aside="from GitHub releases" href="https://github.com/aniruddhkadam7/SmallBird-releases/releases">
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
                  <Download size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">Mac installer</p>
                  <p className="text-xs text-muted">From the website&apos;s download button</p>
                </div>
                <span className="text-lg font-semibold tabular-nums text-ink">{stats.downloads.mac}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <RefreshCw size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">Auto-updates</p>
                  <p className="text-xs text-muted">
                    Windows {stats.downloads.windowsUpdates} · Mac {stats.downloads.macUpdates ?? 0} · Latest{" "}
                    {stats.downloads.latestVersion ?? "--"}: {stats.downloads.latestVersionDownloads}
                  </p>
                </div>
                <span className="text-lg font-semibold tabular-nums text-ink">
                  {stats.downloads.windowsUpdates + (stats.downloads.macUpdates ?? 0)}
                </span>
              </div>
              <p className="text-xs text-muted">Downloads are anonymous, so these are totals, not per user.</p>
            </div>
          ) : (
            <p className="text-sm text-muted">Couldn&apos;t reach GitHub just now.</p>
          )}
        </Section>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={CreditCard} href="/subscriptions" label="Active subscriptions" value={stats.activeSubscriptions} sub={`${stats.expiredSubscriptions} ended`} />
        <Tile
          icon={Users}
          href="/users?segment=never_interviewed"
          label="Never did an interview"
          value={stats.usersNeverInterviewed}
          sub={`${pct(stats.usersNeverInterviewed, stats.totalUsers)} of users`}
        />
        <Tile icon={Activity} href="/payments" label="Minutes bought" value={Math.round(stats.totalMinutesPurchased).toLocaleString()} />
        {/* A status, so it carries an icon and words, not colour alone. */}
        <CardLink href="/users?suspicious=1" className="card flex flex-col gap-3">
          <div className="flex items-center gap-2 text-muted">
            <span
              className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
                stats.suspiciousAccounts > 0 ? "bg-danger/10 text-danger" : "bg-ok/10 text-ok"
              }`}
            >
              {stats.suspiciousAccounts > 0 ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />}
            </span>
            <span className="flex-1 text-xs font-medium leading-tight">Suspicious accounts</span>
            <ChevronRight size={14} className="flex-shrink-0 text-muted/60" aria-hidden />
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums text-ink">{stats.suspiciousAccounts}</p>
            <p className="mt-0.5 text-xs text-muted">{stats.suspiciousAccounts > 0 ? "Needs a look" : "All clear"}</p>
          </div>
        </CardLink>
      </div>
    </div>
  );
}
