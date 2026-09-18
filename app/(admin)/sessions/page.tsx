"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";

interface SessionRow {
  session_id: string;
  user_id: string;
  email: string;
  minutes_consumed: number | null;
  is_suspicious: boolean;
  transcript_id: string | null;
}

interface SessionsListResponse {
  sessions: SessionRow[];
  totalCount: number;
}

// Data volume is small enough (a few hundred sessions total) to fetch in one
// page and group client-side into one row per user, rather than paginating a
// flat list where the same user repeats on every row.
const FETCH_LIMIT = 200;

export default function SessionsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.get("q")?.trim() || undefined;
  const status = searchParams.get("status") || undefined;
  const suspiciousOnly = searchParams.get("suspicious") === "1";

  const { data: result, error } = useAdminQuery<SessionsListResponse>("admin-sessions-list", {
    search,
    status,
    suspiciousOnly,
    limit: FETCH_LIMIT,
    offset: 0,
  });

  const groups = useMemo(() => {
    if (!result) return [];
    const byUser = new Map<
      string,
      { userId: string; email: string; count: number; totalMinutes: number; flagged: number; missingTranscripts: number }
    >();
    for (const s of result.sessions) {
      const g = byUser.get(s.user_id) ?? {
        userId: s.user_id,
        email: s.email,
        count: 0,
        totalMinutes: 0,
        flagged: 0,
        missingTranscripts: 0,
      };
      g.count += 1;
      g.totalMinutes += s.minutes_consumed ?? 0;
      if (s.is_suspicious) g.flagged += 1;
      if (!s.transcript_id) g.missingTranscripts += 1;
      byUser.set(s.user_id, g);
    }
    return Array.from(byUser.values()).sort((a, b) => b.count - a.count);
  }, [result]);

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;
  if (!result) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Interview sessions</h1>
        <p className="text-sm text-muted">
          {result.totalCount} total across {groups.length} user{groups.length === 1 ? "" : "s"} &middot; click a user
          to see their full session list
          {result.totalCount > FETCH_LIMIT && ` (showing most recent ${FETCH_LIMIT})`}
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="w-full sm:w-auto sm:min-w-[240px]">
          <label className="mb-1 block text-xs font-medium text-muted">Search (email or user id)</label>
          <input name="q" defaultValue={search ?? ""} className="input" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Status</label>
          <select name="status" defaultValue={status ?? ""} className="input">
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="expired">Expired</option>
            <option value="terminated">Terminated</option>
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-ink">
          <input type="checkbox" name="suspicious" value="1" defaultChecked={suspiciousOnly} />
          Force-ended by another device only
        </label>
        <button type="submit" className="btn-primary">
          Apply
        </button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Sessions</th>
              <th>Minutes consumed</th>
              <th>Missing transcripts</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr
                key={g.userId}
                onClick={() => router.push(`/users/${g.userId}`)}
                className="cursor-pointer"
              >
                <td className="font-medium">
                  <Link href={`/users/${g.userId}`} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">
                    {g.email}
                  </Link>
                </td>
                <td>{g.count}</td>
                <td>{g.totalMinutes.toFixed(1)}</td>
                <td>
                  {g.missingTranscripts > 0 ? (
                    <span className="badge badge-danger">{g.missingTranscripts} missing</span>
                  ) : (
                    "0"
                  )}
                </td>
                <td>{g.flagged > 0 ? <span className="badge badge-danger">{g.flagged} force-ended</span> : "--"}</td>
              </tr>
            ))}
            {groups.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted">
                  No sessions match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
