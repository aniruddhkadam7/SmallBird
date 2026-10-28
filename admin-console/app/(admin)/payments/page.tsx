"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";
import { PageLoading } from "@/components/PageLoading";
import { FilterChip } from "@/components/FilterChip";
import { formatRupees } from "@/lib/format";
import { PAYMENT_PERIODS } from "@/lib/segments";

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
  // A later minute grant for a payment that was already credited once.
  is_repeat_credit: boolean;
}

interface PaymentsListResponse {
  payments: PaymentRow[];
  totalCount: number;
  totalPaise: number;
  paymentCount: number;
}

const PAGE_SIZE = 50;

export default function PaymentsPage() {
  const searchParams = useSearchParams();
  const search = searchParams.get("q")?.trim() || undefined;
  const periodParam = searchParams.get("period");
  const period = periodParam && periodParam in PAYMENT_PERIODS ? periodParam : undefined;
  const page = Math.max(Number(searchParams.get("page")) || 1, 1);
  const offset = (page - 1) * PAGE_SIZE;

  const { data: result, error } = useAdminQuery<PaymentsListResponse>("admin-payments-list", {
    search,
    period,
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
          Every minute grant traced back to its Razorpay order/payment and whether the webhook that granted it was
          actually recorded.
        </p>
      </div>

      {period && <FilterChip label={PAYMENT_PERIODS[period]} clearHref="/payments" />}

      <div className="card flex items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted">{period ? "Earned" : "Total earned"}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{formatRupees(result.totalPaise)}</p>
        </div>
        <p className="text-sm text-muted">
          {result.paymentCount} payment{result.paymentCount === 1 ? "" : "s"}
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="w-full sm:w-auto sm:min-w-[240px]">
          <label className="mb-1 block text-xs font-medium text-muted">Search (email or Razorpay id)</label>
          <input name="q" defaultValue={search ?? ""} className="input" />
        </div>
        {period && <input type="hidden" name="period" value={period} />}
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
                <td>
                  {p.is_repeat_credit ? (
                    <span
                      className="badge badge-warn"
                      title="This payment had already granted its minutes once -- the same payment credited them again"
                    >
                      Repeat credit, no new payment
                    </span>
                  ) : p.amount_paise != null ? (
                    formatRupees(p.amount_paise)
                  ) : (
                    "--"
                  )}
                </td>
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
            href={`?${new URLSearchParams({ ...(search && { q: search }), ...(period && { period }), page: String(Math.max(page - 1, 1)) })}`}
            className={`btn-secondary ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
          >
            Previous
          </Link>
          <Link
            href={`?${new URLSearchParams({ ...(search && { q: search }), ...(period && { period }), page: String(Math.min(page + 1, totalPages)) })}`}
            className={`btn-secondary ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`}
          >
            Next
          </Link>
        </div>
      </div>
    </div>
  );
}
