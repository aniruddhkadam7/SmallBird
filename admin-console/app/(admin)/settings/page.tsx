"use client";

import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";
import { MfaEnrollment } from "@/components/MfaEnrollment";
import { ChangePasswordPanel } from "@/components/ChangePasswordPanel";

interface AdminRow {
  user_id: string;
  email: string;
  role: string;
  created_at: string;
}

export default function SettingsPage() {
  const { data: result, error } = useAdminQuery<{ admins: AdminRow[] }>("admin-list-admins");

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;

  const admins = result?.admins ?? [];

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Settings</h1>
      </div>

      <ChangePasswordPanel />

      <MfaEnrollment />

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
