"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  plan_id: string;
  remaining_minutes: number;
  total_purchased_minutes: number;
  total_consumed_minutes: number;
  interview_count: number;
  transcript_count: number;
  is_suspicious: boolean;
}

interface UsersListResponse {
  users: UserRow[];
  totalCount: number;
}

const PAGE_SIZE = 50;

export default function UsersPage() {
  const searchParams = useSearchParams();

  const search = searchParams.get("q")?.trim() || undefined;
  const planFilter = searchParams.get("plan") === "free" || searchParams.get("plan") === "paid" ? searchParams.get("plan")! : undefined;
  const suspiciousOnly = searchParams.get("suspicious") === "1";
  const page = Math.max(Number(searchParams.get("page")) || 1, 1);
  const offset = (page - 1) * PAGE_SIZE;

  const { data: result, error } = useAdminQuery<UsersListResponse>("admin-users-list", {
    search,
    planFilter,
    suspiciousOnly,
    limit: PAGE_SIZE,
    offset,
  });

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;
  if (!result) return null;

  const totalPages = Math.max(Math.ceil(result.totalCount / PAGE_SIZE), 1);

  function buildQuery(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (planFilter) params.set("plan", planFilter);
    if (suspiciousOnly) params.set("suspicious", "1");
    if (page > 1) params.set("page", String(page));
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Users</h1>
        <p className="text-sm text-muted">{result.totalCount} total</p>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="min-w-[220px]">
          <label className="mb-1 block text-xs font-medium text-muted">Search (email or user id)</label>
          <input name="q" defaultValue={search ?? ""} className="input" placeholder="jane@example.com" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Plan</label>
          <select name="plan" defaultValue={planFilter ?? ""} className="input">
            <option value="">All</option>
            <option value="free">Free</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-ink">
          <input type="checkbox" name="suspicious" value="1" defaultChecked={suspiciousOnly} />
          Suspicious only
        </label>
        <button type="submit" className="btn-primary">
          Apply
        </button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Plan</th>
              <th>Remaining</th>
              <th>Purchased</th>
              <th>Consumed</th>
              <th>Interviews</th>
              <th>Transcripts</th>
              <th>Signed up</th>
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>
            {result.users.map((u) => (
              <tr key={u.user_id}>
                <td>
                  <Link href={`/users/${u.user_id}`} className="font-medium text-accent hover:underline">
                    {u.email}
                  </Link>
                  {u.display_name && <span className="ml-1 text-xs text-muted">({u.display_name})</span>}
                </td>
                <td>
                  <span className={`badge ${u.plan_id === "free" ? "badge-muted" : "badge-ok"}`}>{u.plan_id}</span>
                </td>
                <td>{Number(u.remaining_minutes).toFixed(1)}</td>
                <td>{Number(u.total_purchased_minutes).toFixed(0)}</td>
                <td>{Number(u.total_consumed_minutes).toFixed(1)}</td>
                <td>{u.interview_count}</td>
                <td>{u.transcript_count}</td>
                <td>{new Date(u.created_at).toLocaleDateString()}</td>
                <td>{u.is_suspicious && <span className="badge badge-danger">Suspicious</span>}</td>
              </tr>
            ))}
            {result.users.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-muted">
                  No users match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted">
        <span>
          Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <Link
            href={buildQuery({ page: page > 1 ? String(page - 1) : undefined })}
            className={`btn-secondary ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
          >
            Previous
          </Link>
          <Link
            href={buildQuery({ page: page < totalPages ? String(page + 1) : undefined })}
            className={`btn-secondary ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`}
          >
            Next
          </Link>
        </div>
      </div>
    </div>
  );
}
