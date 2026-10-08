"use client";

import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";
import { MfaEnrollment } from "@/components/MfaEnrollment";
import { ChangePasswordPanel } from "@/components/ChangePasswordPanel";
import { AppConfigPanel } from "@/components/AppConfigPanel";
import { ModelConfigPanel } from "@/components/ModelConfigPanel";

interface AdminRow {
  user_id: string;
  email: string;
  role: string;
  created_at: string;
}

interface ApiKeyRow {
  keyName: string;
  label: string;
  description: string;
  isSet: boolean;
  keyHint: string | null;
  updatedAt: string | null;
  updatedByEmail: string | null;
}

interface AppConfigResponse {
  settings: Record<string, unknown>;
  apiKeys: ApiKeyRow[];
}

export default function SettingsPage() {
  const { data: result, error } = useAdminQuery<{ admins: AdminRow[] }>("admin-list-admins");
  const { data: appConfig, mutate: mutateConfig } = useAdminQuery<AppConfigResponse>("admin-get-app-settings");

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;

  const admins = result?.admins ?? [];
  const apiKeys = appConfig?.apiKeys ?? [];
  const appSettings = appConfig?.settings ?? {};

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Settings</h1>
      </div>

      <ChangePasswordPanel />

      <MfaEnrollment />

      <ModelConfigPanel settings={appSettings} onSuccess={() => mutateConfig()} />

      {apiKeys.length > 0 && (
        <AppConfigPanel apiKeys={apiKeys} onSuccess={() => mutateConfig()} />
      )}

      <section className="card">
        <h2 className="text-sm font-semibold text-ink">Admin allowlist</h2>
        <p className="mt-1 text-xs text-muted">
          There is no self-service way to add an admin from this app -- see the README&apos;s &quot;Adding an
          admin&quot; section. This is deliberate: granting admin access is a direct database operation, not an
          in-app action.
        </p>
        <ul className="mt-3 divide-y divide-border">
          {admins.map((a) => (
            <li key={a.user_id} className="flex items-center justify-between py-2 text-sm">
              <span>{a.email}</span>
              <span className="text-xs text-muted">
                {a.role} &middot; since {new Date(a.created_at).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
