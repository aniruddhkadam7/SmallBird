"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";
import { PageLoading } from "@/components/PageLoading";

// Every user's current plan (from entitlements via admin-users-list), with
// recurring-billing status merged in from admin-subscriptions-list for users
// on a monthly plan. Most purchases are one-time packs, which never create a
// subscriptions row -- listing only that table left this page empty.

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  plan_id: string;
  remaining_minutes: number;
  total_purchased_minutes: number;
  total_consumed_minutes: number;
}

interface SubscriptionRow {
  subscription_id: string;
  user_id: string;
  plan: string;
  status: string;
  current_period_end: string | null;
}

const PLAN_ORDER = ["free", "starter", "pro", "pro-plus"];
const PLAN_LABEL: Record<string, string> = {
  free: "Free",
  starter: "Starter Pass",
  pro: "Pro Pass",
  "pro-plus": "Pro+ Pass",
};

const STATUS_BADGE: Record<string, string> = {
  active: "badge-ok",
  canceled: "badge-danger",
  halted: "badge-danger",
  inactive: "badge-muted",
};

const planLabel = (id: string) => PLAN_LABEL[id] ?? id;

export default function SubscriptionsPage() {
  const searchParams = useSearchParams();
  const search = searchParams.get("q")?.trim() || undefined;
  const plan = searchParams.get("plan") || undefined; // "paid", "free", or a plan id

  // The user base is small, so fetch it whole and filter by plan here --
  // that keeps the per-plan counts above the table exact.
  const { data: users, error } = useAdminQuery<{ users: UserRow[]; totalCount: number }>("admin-users-list", {
    search,
    limit: 200,
    offset: 0,
  });
  const { data: subs } = useAdminQuery<{ subscriptions: SubscriptionRow[] }>("admin-subscriptions-list", {
    limit: 200,
    offset: 0,
  });

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;
  if (!users) return <PageLoading error={error} />;

  const subByUser = new Map((subs?.subscriptions ?? []).map((s) => [s.user_id, s]));

  const counts = new Map<string, number>();
  for (const u of users.users) counts.set(u.plan_id, (counts.get(u.plan_id) ?? 0) + 1);
  const planIds = [
    ...PLAN_ORDER.filter((p) => counts.has(p) || p !== "free"),
    ...[...counts.keys()].filter((p) => !PLAN_ORDER.includes(p)),
  ];
  const paidCount = users.users.filter((u) => u.plan_id !== "free").length;

  const rows = users.users
    .filter((u) => !plan || (plan === "paid" ? u.plan_id !== "free" : u.plan_id === plan))
    .sort(
      (a, b) =>
        PLAN_ORDER.indexOf(b.plan_id) - PLAN_ORDER.indexOf(a.plan_id) ||
        Number(b.remaining_minutes) - Number(a.remaining_minutes),
    );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Subscriptions</h1>
        <p className="text-sm text-muted">
          {paidCount} paid of {users.users.length} users. Monthly plans also show their billing status.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {planIds.map((p) => (
          <Link
            key={p}
            href={plan === p ? "?" : `?plan=${p}`}
            className={`card transition-colors hover:border-accent ${plan === p ? "border-accent" : ""}`}
          >
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{planLabel(p)}</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{counts.get(p) ?? 0}</p>
          </Link>
        ))}
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="min-w-[220px]">
          <label className="mb-1 block text-xs font-medium text-muted">Search (email)</label>
          <input name="q" defaultValue={search ?? ""} className="input" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Plan</label>
          <select name="plan" defaultValue={plan ?? ""} className="input">
            <option value="">All</option>
            <option value="paid">Paid only</option>
            {planIds.map((p) => (
              <option key={p} value={p}>
                {planLabel(p)}
              </option>
            ))}
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
              <th>Billing</th>
              <th>Minutes left</th>
              <th>Purchased</th>
              <th>Used</th>
              <th>Signed up</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const sub = subByUser.get(u.user_id);
              return (
                <tr key={u.user_id}>
                  <td>
                    <Link href={`/users/${u.user_id}`} className="font-medium text-accent hover:underline">
                      {u.email}
                    </Link>
                    {u.display_name && <span className="ml-1 text-xs text-muted">({u.display_name})</span>}
                  </td>
                  <td>
                    <span className={`badge ${u.plan_id === "free" ? "badge-muted" : "badge-ok"}`}>
                      {planLabel(u.plan_id)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">
                    {sub ? (
                      <span className="flex items-center gap-2">
                        <span className={`badge ${STATUS_BADGE[sub.status] ?? "badge-muted"}`}>{sub.status}</span>
                        {sub.current_period_end && (
                          <span className="text-xs text-muted">
                            {sub.status === "active" ? "renews" : "ends"}{" "}
                            {new Date(sub.current_period_end).toLocaleDateString()}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted">{u.plan_id === "free" ? "--" : "one-time"}</span>
                    )}
                  </td>
                  <td>{Number(u.remaining_minutes).toFixed(1)}</td>
                  <td>{Number(u.total_purchased_minutes).toFixed(0)}</td>
                  <td>{Number(u.total_consumed_minutes).toFixed(1)}</td>
                  <td className="whitespace-nowrap">{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted">
                  No users on this plan.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
