"use client";

import Link from "next/link";
import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";
import { PageLoading } from "@/components/PageLoading";

interface AbuseFlag {
  severity: "RED" | "YELLOW";
  category: string;
  user_id: string;
  email: string;
  message: string;
  detected_at: string;
}

export default function AbusePage() {
  const { data: result, error } = useAdminQuery<{ flags: AbuseFlag[] }>("admin-abuse-flags");

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;
  if (!result) return <PageLoading error={error} />;

  const flags = result.flags;
  const redCount = flags.filter((f) => f.severity === "RED").length;
  const yellowCount = flags.filter((f) => f.severity === "YELLOW").length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Abuse / Risk</h1>
        <p className="text-sm text-muted">
          {redCount} red, {yellowCount} yellow. Heuristic flags for investigation only -- nothing here is acted on
          automatically.
        </p>
      </div>

      <div className="space-y-2">
        {flags.map((f, i) => (
          <div key={i} className="card flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className={`badge ${f.severity === "RED" ? "badge-danger" : "badge-warn"}`}>{f.severity}</span>
                <span className="text-xs font-medium uppercase tracking-wide text-muted">{f.category}</span>
              </div>
              <p className="mt-1.5 text-sm text-ink">{f.message}</p>
              <Link href={`/users/${f.user_id}`} className="mt-1 inline-block text-xs text-accent hover:underline">
                {f.email}
              </Link>
            </div>
            <span className="whitespace-nowrap text-xs text-muted">{new Date(f.detected_at).toLocaleString()}</span>
          </div>
        ))}
        {flags.length === 0 && <div className="card text-center text-sm text-muted">No flags right now.</div>}
      </div>
    </div>
  );
}
