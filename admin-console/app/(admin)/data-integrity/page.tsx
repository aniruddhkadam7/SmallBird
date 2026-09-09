"use client";

import Link from "next/link";
import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";

interface IntegrityCheck {
  severity: "RED" | "YELLOW";
  check_name: string;
  user_id: string;
  email: string;
  message: string;
}

export default function DataIntegrityPage() {
  const { data: result, error } = useAdminQuery<{ checks: IntegrityCheck[] }>("admin-data-integrity");

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;
  if (!result) return null;

  const checks = result.checks;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Data integrity</h1>
        <p className="text-sm text-muted">{checks.length} issue(s) found. Read-only checks, run live on every visit.</p>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Check</th>
              <th>User</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c, i) => (
              <tr key={i}>
                <td>
                  <span className={`badge ${c.severity === "RED" ? "badge-danger" : "badge-warn"}`}>{c.severity}</span>
                </td>
                <td className="font-mono text-xs">{c.check_name}</td>
                <td>
                  <Link href={`/users/${c.user_id}`} className="text-accent hover:underline">
                    {c.email}
                  </Link>
                </td>
                <td className="text-muted">{c.message}</td>
              </tr>
            ))}
            {checks.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-muted">
                  No integrity issues found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
