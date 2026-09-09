"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";

interface SubscriptionRow {
  subscription_id: string;
  user_id: string;
  email: string;
  plan: string;
  status: string;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}

interface SubscriptionsListResponse {
  subscriptions: SubscriptionRow[];
  totalCount: number;
}

const STATUS_BADGE: Record<string, string> = {
  active: "badge-ok",
  canceled: "badge-danger",
  halted: "badge-danger",
  inactive: "badge-muted",
};

export default function SubscriptionsPage() {
  const searchParams = useSearchParams();
  const search = searchParams.get("q")?.trim() || undefined;
  const status = searchParams.get("status") || undefined;

  const { data: result, error } = useAdminQuery<SubscriptionsListResponse>("admin-subscriptions-list", {
    search,
    status,
    limit: 100,
    offset: 0,
  });

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;
  if (!result) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Subscriptions</h1>
        <p className="text-sm text-muted">{result.totalCount} total recurring subscription records.</p>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="min-w-[220px]">
          <label className="mb-1 block text-xs font-medium text-muted">Search (email)</label>
          <input name="q" defaultValue={search ?? ""} className="input" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Status</label>
          <select name="status" defaultValue={status ?? ""} className="input">
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="canceled">Canceled</option>
            <option value="halted">Halted</option>
          </select>
        </div>
        <button type="submit" className="btn-primary">
          Apply
        </button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Renews/ends</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {result.subscriptions.map((s) => (
              <tr key={s.subscription_id}>
                <td>
                  <Link href={`/users/${s.user_id}`} className="text-accent hover:underline">
                    {s.email}
                  </Link>
                </td>
                <td>{s.plan}</td>
                <td>
                  <span className={`badge ${STATUS_BADGE[s.status] ?? "badge-muted"}`}>{s.status}</span>
                </td>
                <td>{s.current_period_end ? new Date(s.current_period_end).toLocaleDateString() : "--"}</td>
                <td className="whitespace-nowrap">{new Date(s.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {result.subscriptions.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted">
                  No recurring subscriptions yet -- only one-time purchases so far (see Payments).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
