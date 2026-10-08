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
        </div>
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
