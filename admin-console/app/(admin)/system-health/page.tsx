"use client";

import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";
import { PageLoading } from "@/components/PageLoading";
import { MaintenanceModePanel } from "@/components/MaintenanceModePanel";

interface SystemHealth {
  sessionsStuckActive: number;
  failedSessions24h: number;
  failedSessions7d: number;
  webhookEventsLast24h: number;
  lastWebhookEventAt: string | null;
  lastEntitlementLedgerWriteAt: string | null;
  lastInterviewSessionAt: string | null;
  sessionsMissingDuration7d: number;
}

interface SettingMeta {
  value: string;
  description: string;
  updatedAt: string | null;
  updatedByEmail: string | null;
}

interface AppSettings {
  maintenance_mode: SettingMeta;
  maintenance_message: SettingMeta;
}

interface AppSettingsResponse {
  settings: AppSettings;
  apiKeys: unknown[];
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "danger" | "warn" | "ok" }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p
        className={`mt-1.5 text-2xl font-semibold ${
          tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default function SystemHealthPage() {
  const { data: health, error } = useAdminQuery<SystemHealth>("admin-system-health");
  const { data: appConfig, mutate: mutateConfig } = useAdminQuery<AppSettingsResponse>("admin-get-app-settings");

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;
  if (!health) return <PageLoading error={error} />;

  const maintenanceMode = appConfig?.settings?.maintenance_mode;
  const maintenanceMessage = appConfig?.settings?.maintenance_message;

  return (
    <div className="space-y-6">
      {maintenanceMode && maintenanceMessage && (
        <MaintenanceModePanel
          maintenanceMode={maintenanceMode}
          maintenanceMessage={maintenanceMessage}
          onSuccess={() => mutateConfig()}
        />
      )}

      <div>
        <h1 className="text-lg font-semibold text-ink">System health</h1>
        <p className="text-sm text-muted">
          Derived from operational data already in the schema. There is no error-log table yet, so this can&apos;t
          show raw exceptions -- adding a <code className="text-xs">system_errors</code> table every Edge Function
          writes to on failure (or wiring up Supabase&apos;s platform log API) would be the next step for that.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat
          label="Sessions stuck active (>10 min)"
          value={health.sessionsStuckActive}
          tone={health.sessionsStuckActive > 0 ? "warn" : "ok"}
        />
        <Stat
          label="Failed sessions (24h)"
          value={health.failedSessions24h}
          tone={health.failedSessions24h > 0 ? "warn" : "ok"}
        />
        <Stat label="Failed sessions (7d)" value={health.failedSessions7d} />
        <Stat
          label="Sessions missing duration (7d)"
          value={health.sessionsMissingDuration7d}
          tone={health.sessionsMissingDuration7d > 0 ? "warn" : "ok"}
        />
        <Stat label="Webhook events (24h)" value={health.webhookEventsLast24h} />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">Last activity</h2>
        <div className="card space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-muted">Last interview session started</span>
            <span>{health.lastInterviewSessionAt ? new Date(health.lastInterviewSessionAt).toLocaleString() : "never"}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted">Last entitlement ledger write</span>
            <span>
              {health.lastEntitlementLedgerWriteAt ? new Date(health.lastEntitlementLedgerWriteAt).toLocaleString() : "never"}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted">Last Razorpay webhook processed</span>
            <span>{health.lastWebhookEventAt ? new Date(health.lastWebhookEventAt).toLocaleString() : "never"}</span>
          </div>
        </div>
      </section>

    </div>
  );
}
