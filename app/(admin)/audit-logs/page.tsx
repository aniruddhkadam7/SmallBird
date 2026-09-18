"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";

interface AuditLogRow {
  id: number;
  admin_email: string;
  action: string;
  target_user_id: string | null;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface AuditLogsResponse {
  logs: AuditLogRow[];
  totalCount: number;
}

const PAGE_SIZE = 50;

export default function AuditLogsPage() {
  const searchParams = useSearchParams();
  const page = Math.max(Number(searchParams.get("page")) || 1, 1);
  const offset = (page - 1) * PAGE_SIZE;

  const { data: result, error } = useAdminQuery<AuditLogsResponse>("admin-audit-logs", {
    limit: PAGE_SIZE,
    offset,
  });

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;
  if (!result) return null;

  const totalPages = Math.max(Math.ceil(result.totalCount / PAGE_SIZE), 1);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Audit logs</h1>
        <p className="text-sm text-muted">{result.totalCount} total actions recorded</p>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Admin</th>
              <th>Action</th>
              <th>Target user</th>
              <th>Change</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {result.logs.map((log) => (
              <tr key={log.id}>
                <td className="whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</td>
                <td>{log.admin_email}</td>
                <td>
                  <span className="badge badge-muted">{log.action}</span>
                </td>
                <td>
                  {log.target_user_id ? (
                    <Link href={`/users/${log.target_user_id}`} className="font-mono text-xs text-accent hover:underline">
                      {log.target_user_id.slice(0, 8)}...
                    </Link>
                  ) : (
                    "--"
                  )}
                </td>
                <td className="text-xs text-muted">
                  {log.previous_value && log.new_value
                    ? `${JSON.stringify(log.previous_value)} -> ${JSON.stringify(log.new_value)}`
                    : "--"}
                </td>
                <td className="max-w-xs truncate text-muted" title={log.reason ?? ""}>
                  {log.reason ?? "--"}
                </td>
              </tr>
            ))}
            {result.logs.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-muted">
                  No admin actions recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
        <span>
          Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <Link
            href={`?page=${Math.max(page - 1, 1)}`}
            className={`btn-secondary ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
          >
            Previous
          </Link>
          <Link
            href={`?page=${Math.min(page + 1, totalPages)}`}
            className={`btn-secondary ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`}
          >
            Next
          </Link>
        </div>
      </div>
    </div>
  );
}
