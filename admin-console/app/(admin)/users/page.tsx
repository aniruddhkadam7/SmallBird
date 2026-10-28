"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";
import { PageLoading } from "@/components/PageLoading";
import { ChevronRight } from "lucide-react";
import type { DeviceSummary } from "@/lib/devices";
import { formatJoined } from "@/lib/format";

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
  devices: DeviceSummary[];
  last_seen_at: string | null;
  is_owner: boolean;
}

interface UsersListResponse {
  users: UserRow[];
  totalCount: number;
}

const PAGE_SIZE = 50;
const CLIENT_FILTERS = ["desktop", "browser", "website", "none"];

export default function UsersPage() {
  const searchParams = useSearchParams();

  const search = searchParams.get("q")?.trim() || undefined;
  const planFilter = searchParams.get("plan") === "free" || searchParams.get("plan") === "paid" ? searchParams.get("plan")! : undefined;
  const suspiciousOnly = searchParams.get("suspicious") === "1";
  const clientParam = searchParams.get("device");
  const clientFilter = clientParam && CLIENT_FILTERS.includes(clientParam) ? clientParam : undefined;
  const page = Math.max(Number(searchParams.get("page")) || 1, 1);
  const offset = (page - 1) * PAGE_SIZE;

  const { data: result, error } = useAdminQuery<UsersListResponse>("admin-users-list", {
    search,
    planFilter,
    suspiciousOnly,
    clientFilter,
    limit: PAGE_SIZE,
    offset,
  });

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;
  if (!result) return <PageLoading error={error} />;

  const totalPages = Math.max(Math.ceil(result.totalCount / PAGE_SIZE), 1);

  function buildQuery(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (planFilter) params.set("plan", planFilter);
    if (suspiciousOnly) params.set("suspicious", "1");
    if (clientFilter) params.set("device", clientFilter);
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
        <div className="w-full sm:w-auto sm:min-w-[240px]">
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
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Device</label>
          <select name="device" defaultValue={clientFilter ?? ""} className="input">
            <option value="">All</option>
            <option value="desktop">Desktop app</option>
            <option value="browser">Phone / browser</option>
            <option value="website">Website sign-in</option>
            <option value="none">No device recorded</option>
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

      {/* Just who they are and whether they pay; tapping a user opens
          everything else (devices, minutes, sessions, transcripts). */}
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-card">
        {result.users.map((u) => {
          const paid = u.plan_id !== "free";
          return (
            <li key={u.user_id}>
              <Link
                href={`/users/${u.user_id}`}
                className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-subtle active:bg-subtle"
              >
                <div
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent"
                  aria-hidden
                >
                  {(u.display_name || u.email).charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{u.display_name || u.email}</p>
                  {u.display_name && <p className="truncate text-xs text-muted">{u.email}</p>}
                  <p className="truncate text-xs text-muted">Joined {formatJoined(u.created_at)}</p>
                </div>
                {u.is_owner ? (
                  <span className="badge badge-ok">Owner</span>
                ) : (
                  <span className={`badge ${paid ? "badge-ok" : "badge-muted"}`}>{paid ? "Paid" : "Free"}</span>
                )}
                {u.is_suspicious && <span className="badge badge-danger">Suspicious</span>}
                <ChevronRight size={16} className="flex-shrink-0 text-muted" aria-hidden />
              </Link>
            </li>
          );
        })}
        {result.users.length === 0 && <li className="py-8 text-center text-sm text-muted">No users match these filters.</li>}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
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
