"use client";

import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";
import { PageLoading } from "@/components/PageLoading";
import { AppConfigPanel, type ApiKeyRow } from "@/components/AppConfigPanel";

interface AppConfigResponse {
  settings: Record<string, unknown>;
  apiKeys: ApiKeyRow[];
}

export default function ApiKeysPage() {
  const { data: appConfig, error, mutate } = useAdminQuery<AppConfigResponse>("admin-get-app-settings");

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;
  if (!appConfig) return <PageLoading error={error} />;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">API keys</h1>
        <p className="text-sm text-muted">Provider and payment keys used by the edge functions.</p>
      </div>

      {appConfig.apiKeys.length > 0 ? (
        <AppConfigPanel apiKeys={appConfig.apiKeys} onSuccess={() => mutate()} />
      ) : (
        <div className="card text-sm text-muted">No API keys are configured.</div>
      )}
    </div>
  );
}
