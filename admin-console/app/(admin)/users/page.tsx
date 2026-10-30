"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";
import { PageLoading } from "@/components/PageLoading";
import { useState } from "react";
import { ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import { appStatus, type DeviceSummary } from "@/lib/devices";
import { avatarGradient, formatJoined, formatMinutes } from "@/lib/format";
import { USER_SEGMENTS } from "@/lib/segments";
import { FilterChip } from "@/components/FilterChip";
import { formatAiCost, formatDeepgramCost, useUserAiCosts } from "@/lib/userAiCosts";

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  // From Razorpay checkout or the user's newest CV (0062); absent before that.
  phone?: string | null;
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
  const segmentParam = searchParams.get("segment");
  const segment = segmentParam && segmentParam in USER_SEGMENTS ? segmentParam : undefined;
  const page = Math.max(Number(searchParams.get("page")) || 1, 1);
  const offset = (page - 1) * PAGE_SIZE;
  const activeFilters = [planFilter, clientFilter, suspiciousOnly || undefined].filter(Boolean).length;
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { data: result, error } = useAdminQuery<UsersListResponse>("admin-users-list", {
    search,
    planFilter,
    suspiciousOnly,
    clientFilter,
    segment,
    limit: PAGE_SIZE,
    offset,
  });
  // Loads after the list itself, so the list never waits on OpenAI.
  const aiCosts = useUserAiCosts(result?.users.map((u) => u.user_id) ?? []);

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;
  if (!result) return <PageLoading error={error} />;

  const totalPages = Math.max(Math.ceil(result.totalCount / PAGE_SIZE), 1);

  function buildQuery(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (planFilter) params.set("plan", planFilter);
    if (suspiciousOnly) params.set("suspicious", "1");
    if (clientFilter) params.set("device", clientFilter);
    if (segment) params.set("segment", segment);
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

      {/* One compact row on phones: search plus a Filters button. The
          filters (always shown on wide screens) apply as soon as one is
          picked, and stay part of the form while hidden so a search keeps
          them. */}
      {/* Names what's being shown -- a Home card's slice, or a filter that's
          hidden behind the Filters button on phones. */}
      {(segment || planFilter || suspiciousOnly) && (
        <FilterChip
          label={[
            segment && USER_SEGMENTS[segment],
            planFilter === "paid" ? "Paid" : planFilter === "free" ? "Free" : undefined,
            suspiciousOnly ? "Suspicious" : undefined,
          ]
            .filter(Boolean)
            .join(" · ")}
          clearHref="/users"
        />
      )}

      <form className="space-y-2 lg:flex lg:items-center lg:gap-3 lg:space-y-0" method="get">
        {/* Keeps a Home card's slice while searching or filtering within it. */}
        {segment && <input type="hidden" name="segment" value={segment} />}
        <div className="flex gap-2 lg:w-80">
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input
              name="q"
              type="search"
              enterKeyHint="search"
              defaultValue={search ?? ""}
              className="input !pl-9"
              placeholder="Search name, email, phone or user id"
              aria-label="Search users"
            />
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            className={`btn-secondary relative px-3 lg:hidden ${filtersOpen ? "border-accent text-accent" : ""}`}
          >
            <SlidersHorizontal size={16} aria-hidden />
            Filters
            {activeFilters > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white">
                {activeFilters}
              </span>
            )}
          </button>
        </div>
        <div className={`${filtersOpen ? "grid" : "hidden"} grid-cols-2 items-center gap-2 lg:flex`}>
          <select
            name="plan"
            defaultValue={planFilter ?? ""}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="input py-1.5 lg:!w-auto"
            aria-label="Plan"
          >
            <option value="">All plans</option>
            <option value="free">Free</option>
            <option value="paid">Paid</option>
          </select>
          <select
            name="device"
            defaultValue={clientFilter ?? ""}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="input py-1.5 lg:!w-auto"
            aria-label="Device"
          >
            <option value="">All devices</option>
            <option value="desktop">Desktop app</option>
            <option value="browser">Phone / browser</option>
            <option value="website">Website sign-in</option>
            <option value="none">No device recorded</option>
          </select>
          <label className="col-span-2 flex items-center gap-2 px-1 text-sm text-ink">
            <input
              type="checkbox"
              name="suspicious"
              value="1"
              defaultChecked={suspiciousOnly}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
            />
            Suspicious only
          </label>
        </div>
      </form>

      {/* Just who they are and whether they pay; tapping a user opens
          everything else (devices, minutes, sessions, transcripts). */}
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-card">
        {result.users.map((u) => {
          const paid = u.plan_id !== "free";
          const status = appStatus(u.devices, u.interview_count);
          return (
            <li key={u.user_id}>
              <Link
                href={`/users/${u.user_id}`}
                className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-subtle active:bg-subtle"
              >
                <div
                  className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-sm font-semibold text-white shadow-sm ${avatarGradient(u.email)}`}
                  aria-hidden
                >
                  {(u.display_name || u.email).charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{u.display_name || u.email}</p>
                  {u.display_name && <p className="truncate text-xs text-muted">{u.email}</p>}
                  {u.phone && <p className="truncate text-xs text-muted">{u.phone}</p>}
                  <p className="truncate text-xs text-muted">Joined {formatJoined(u.created_at)}</p>
                  <p className="truncate text-xs text-muted">
                    <span className="font-medium text-ink">{formatMinutes(u.remaining_minutes)} min left</span>
                    {" · "}
                    {formatMinutes(u.total_consumed_minutes)} used
                  </p>
                  <p className="text-xs text-muted">
                    AI spent{" "}
                    <span className="font-medium text-ink">
                      {formatAiCost(aiCosts?.users[u.user_id]?.totalUsd ?? 0, aiCosts)}
                    </span>
                    {" · "}Deepgram{" "}
                    <span className="font-medium text-ink">
                      {formatDeepgramCost(aiCosts?.users[u.user_id]?.deepgramUsd ?? 0, aiCosts)}
                    </span>
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {u.is_owner ? (
                      <span className="badge badge-ok">Owner</span>
                    ) : (
                      <span className={`badge ${paid ? "badge-ok" : "badge-muted"}`}>{paid ? "Paid" : "Free"}</span>
                    )}
                    <span className={`badge ${status.badge}`}>{status.label}</span>
                    {u.is_suspicious && <span className="badge badge-danger">Suspicious</span>}
                  </div>
                </div>
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
