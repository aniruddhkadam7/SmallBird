"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";
import { PageLoading } from "@/components/PageLoading";

interface PaymentRow {
  ledger_id: number;
  user_id: string;
  email: string;
  minutes_granted: number;
  reference_id: string | null;
  created_at: string;
  webhook_recorded: boolean;
  amount_paise: number | null;
  purchase_plan_id: string | null;
  subscription_plan: string | null;
  subscription_status: string | null;
}

interface PaymentsListResponse {
  payments: PaymentRow[];
  totalCount: number;
}

const PAGE_SIZE = 50;

export default function PaymentsPage() {
  const searchParams = useSearchParams();
  const search = searchParams.get("q")?.trim() || undefined;
  const page = Math.max(Number(searchParams.get("page")) || 1, 1);
  const offset = (page - 1) * PAGE_SIZE;

  const { data: result, error } = useAdminQuery<PaymentsListResponse>("admin-payments-list", {
    search,
    limit: PAGE_SIZE,
    offset,
  });

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;
  if (!result) return <PageLoading error={error} />;

  const totalPages = Math.max(Math.ceil(result.totalCount / PAGE_SIZE), 1);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Payments</h1>
        <p className="text-sm text-muted">
          {result.totalCount} total &middot; every minute grant traced back to its Razorpay order/payment and
          whether the webhook that granted it was actually recorded.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="w-full sm:w-auto sm:min-w-[240px]">
          <label className="mb-1 block text-xs font-medium text-muted">Search (email or Razorpay id)</label>
          <input name="q" defaultValue={search ?? ""} className="input" />
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
              <th>Amount</th>
              <th>Plan</th>
              <th>Minutes granted</th>
              <th>Razorpay ref</th>
              <th>Webhook recorded</th>
              <th>Subscription status</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {result.payments.map((p) => (
              <tr key={p.ledger_id}>
                <td>
                  <Link href={`/users/${p.user_id}`} className="text-accent hover:underline">
                    {p.email}
                  </Link>
                </td>
                <td>{p.amount_paise != null ? `₹${(p.amount_paise / 100).toFixed(2)}` : "--"}</td>
                <td>{p.purchase_plan_id ?? p.subscription_plan ?? "--"}</td>
                <td>+{Number(p.minutes_granted).toFixed(0)}</td>
                <td className="font-mono text-xs text-muted">{p.reference_id ?? "--"}</td>
                <td>
                  <span className={`badge ${p.webhook_recorded ? "badge-ok" : "badge-danger"}`}>
                    {p.webhook_recorded ? "Yes" : "No record"}
                  </span>
                </td>
                <td>{p.subscription_status ?? "--"}</td>
                <td className="whitespace-nowrap">{new Date(p.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {result.payments.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-muted">
                  No payments match this search.
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
            href={`?${new URLSearchParams({ ...(search && { q: search }), page: String(Math.max(page - 1, 1)) })}`}
            className={`btn-secondary ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
          >
            Previous
          </Link>
          <Link
            href={`?${new URLSearchParams({ ...(search && { q: search }), page: String(Math.min(page + 1, totalPages)) })}`}
            className={`btn-secondary ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`}
          >
            Next
          </Link>
        </div>
      </div>
    </div>
  );
}
