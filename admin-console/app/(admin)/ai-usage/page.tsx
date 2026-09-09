"use client";

import Link from "next/link";
import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";

interface AiUsageSummary {
  tokensToday: number;
  tokensThisWeek: number;
  tokensThisMonth: number;
  estimatedCostUsd: number;
  byModel: { model: string; provider: string; calls: number; totalTokens: number; estimatedCostUsd: number }[];
  byUser: { userId: string; email: string; calls: number; totalTokens: number; estimatedCostUsd: number }[];
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold text-ink">{value}</p>
    </div>
  );
}

export default function AiUsagePage() {
  const { data: summary, error } = useAdminQuery<AiUsageSummary>("admin-ai-usage");

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;
  if (!summary) return null;

  const empty = summary.byModel.length === 0 && summary.byUser.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">AI usage</h1>
        <p className="text-sm text-muted">From llm-proxy&apos;s usage_costs logging.</p>
      </div>

      {empty && (
        <div className="card text-sm text-muted">
          No AI usage logged yet -- usage_costs is empty. This populates automatically once traffic flows through
          llm-proxy.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Tokens today" value={summary.tokensToday.toLocaleString()} />
        <Stat label="Tokens this week" value={summary.tokensThisWeek.toLocaleString()} />
        <Stat label="Tokens this month" value={summary.tokensThisMonth.toLocaleString()} />
        <Stat label="Estimated cost" value={`$${summary.estimatedCostUsd.toFixed(2)}`} />
      </div>

      {summary.byModel.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">By model</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Provider</th>
                  <th>Calls</th>
                  <th>Tokens</th>
                  <th>Estimated cost</th>
                </tr>
              </thead>
              <tbody>
                {summary.byModel.map((m, i) => (
                  <tr key={i}>
                    <td>{m.model}</td>
                    <td>{m.provider}</td>
                    <td>{m.calls}</td>
                    <td>{m.totalTokens.toLocaleString()}</td>
                    <td>${m.estimatedCostUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {summary.byUser.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">By user (top 50)</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Calls</th>
                  <th>Tokens</th>
                  <th>Estimated cost</th>
                </tr>
              </thead>
              <tbody>
                {summary.byUser.map((u) => (
                  <tr key={u.userId}>
                    <td>
                      <Link href={`/users/${u.userId}`} className="text-accent hover:underline">
                        {u.email}
                      </Link>
                    </td>
                    <td>{u.calls}</td>
                    <td>{u.totalTokens.toLocaleString()}</td>
                    <td>${u.estimatedCostUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
