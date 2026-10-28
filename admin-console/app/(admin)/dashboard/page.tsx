"use client";

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

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "danger" | "warn" }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p
        className={`mt-1.5 text-2xl font-semibold ${
          tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default function DashboardPage() {
  const { data: stats, error } = useAdminQuery<DashboardStats>("admin-dashboard-stats");

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;
  if (!stats) return <PageLoading error={error} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Overview</h1>
        <p className="text-sm text-muted">Cached client-side -- refreshes automatically in the background.</p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">Users</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Total users" value={stats.totalUsers} />
          <Stat label="Free" value={stats.freeUsers} />
          <Stat label="Paid" value={stats.paidUsers} />
          <Stat
            label="Suspicious accounts"
            value={stats.suspiciousAccounts}
            tone={stats.suspiciousAccounts > 0 ? "danger" : undefined}
          />
          <Stat label="Sign-ups today" value={stats.signupsToday} />
          <Stat label="Sign-ups this week" value={stats.signupsThisWeek} />
          <Stat label="Sign-ups this month" value={stats.signupsThisMonth} />
          <Stat label="Active last 7 days" value={stats.activeUsers7d} />
          <Stat label="Never did an interview" value={stats.usersNeverInterviewed} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">Devices (users)</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Desktop app" value={stats.devices.desktopUsers} />
          <Stat label="Desktop · Windows" value={stats.devices.desktopWindows} />
          <Stat label="Desktop · Mac" value={stats.devices.desktopMac} />
          <Stat label="Phone" value={stats.devices.phoneUsers} />
          <Stat label="Phone · Android" value={stats.devices.androidUsers} />
          <Stat label="Phone · iPhone" value={stats.devices.iosUsers} />
          <Stat label="Browser on computer" value={stats.devices.computerBrowserUsers} />
          <Stat label="Website only (no app, no phone)" value={stats.devices.websiteOnlyUsers} />
        </div>
        <p className="mt-2 text-xs text-muted">
          Desktop use is recorded from each user&apos;s next sign-in or interview, so older desktop users fill in over time.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">Downloads</h2>
        {stats.downloads ? (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <Stat label="Windows installer downloads" value={stats.downloads.windowsInstaller} />
              <Stat label="Mac downloads" value={stats.downloads.mac} />
              <Stat label="Auto-updates" value={stats.downloads.windowsUpdates} />
              <Stat
                label={`Latest (${stats.downloads.latestVersion ?? "--"})`}
                value={stats.downloads.latestVersionDownloads}
              />
            </div>
            <p className="mt-2 text-xs text-muted">
              From GitHub releases. Downloads are anonymous, so they are totals only, not per user.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">Could not load download counts from GitHub right now.</p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">Subscriptions</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Active subscriptions" value={stats.activeSubscriptions} />
          <Stat label="Expired subscriptions" value={stats.expiredSubscriptions} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">Minutes</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Purchased" value={stats.totalMinutesPurchased.toFixed(0)} />
          <Stat label="Consumed" value={stats.totalMinutesConsumed.toFixed(1)} />
          <Stat label="Remaining" value={stats.totalMinutesRemaining.toFixed(1)} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">Interviews</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Total" value={stats.totalInterviews} />
          <Stat label="Today" value={stats.interviewsToday} />
          <Stat label="This week" value={stats.interviewsThisWeek} />
          <Stat label="This month" value={stats.interviewsThisMonth} />
          <Stat label="Transcripts" value={stats.totalTranscripts} />
          <Stat
            label="Failed sessions"
            value={stats.failedSessions}
            tone={stats.failedSessions > 0 ? "warn" : undefined}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">AI usage</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Total tokens" value={stats.totalAiTokens.toLocaleString()} />
          <Stat label="Estimated cost" value={`$${stats.estimatedAiCostUsd.toFixed(2)}`} />
        </div>
      </section>
    </div>
  );
}
