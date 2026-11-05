"use client";

import { useState } from "react";
import { AdminApiError } from "@/lib/adminApi";
import { dollars, percentOff, pricingAction, rupees, saleStatus, when, type PlanRow } from "@/lib/pricing";
import { Modal } from "@/components/Modal";

// Regular (non-sale) price of each paid plan, in both currencies. Changes go
// live on the website within about a minute; payments already in checkout
// at the old price still credit for 24 hours.
export function PricesPanel({ plans, onChanged }: { plans: PlanRow[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const paid = plans.filter((p) => p.price_inr_paise > 0);

  return (
    <section className="card">
      <h2 className="text-sm font-semibold text-ink">Plans & regular prices</h2>
      <p className="mt-1 text-xs text-muted">
        These are the everyday prices. A sale (below) temporarily shows a lower price and then returns to these on its
        own.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-2 pr-3 font-medium">Plan</th>
              <th className="py-2 pr-3 font-medium">Minutes</th>
              <th className="py-2 pr-3 font-medium">India</th>
              <th className="py-2 pr-3 font-medium">International</th>
              <th className="py-2 pr-3 font-medium">Now on the website</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paid.map((plan) => {
              const status = saleStatus(plan);
              return (
                <tr key={plan.id}>
                  <td className="py-2.5 pr-3 font-medium text-ink">{plan.display_name}</td>
                  <td className="py-2.5 pr-3 text-muted">{plan.included_minutes}</td>
                  <td className="py-2.5 pr-3">{rupees(plan.price_inr_paise)}</td>
                  <td className="py-2.5 pr-3">{dollars(plan.price_usd_cents)}</td>
                  <td className="py-2.5 pr-3 text-xs">
                    {status === "live" ? (
                      <span className="text-ok">
                        On sale: {rupees(plan.sale_price_inr_paise)} / {dollars(plan.sale_price_usd_cents)} ·{" "}
                        {percentOff(plan.price_inr_paise, plan.sale_price_inr_paise) ||
                          percentOff(plan.price_usd_cents, plan.sale_price_usd_cents)}
                      </span>
                    ) : status === "scheduled" ? (
                      <span className="text-warn">Sale starts {when(plan.sale_starts_at)}</span>
                    ) : (
                      <span className="text-muted">Regular price</span>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    <button type="button" className="btn-secondary" onClick={() => setEditing(plan)}>
                      Change price
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={`Change ${editing.display_name} price`} onClose={() => setEditing(null)}>
          <EditPrice
            plan={editing}
            onDone={() => {
              setEditing(null);
              onChanged();
            }}
          />
        </Modal>
      )}
    </section>
  );
}

function EditPrice({ plan, onDone }: { plan: PlanRow; onDone: () => void }) {
  const [inr, setInr] = useState(String(plan.price_inr_paise / 100));
  const [usd, setUsd] = useState(String(plan.price_usd_cents / 100));
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inrPaise = Math.round(Number(inr) * 100);
  const usdCents = Math.round(Number(usd) * 100);
  const valid = inrPaise > 0 && usdCents > 0;
  const unchanged = inrPaise === plan.price_inr_paise && usdCents === plan.price_usd_cents;

  async function save() {
    setLoading(true);
    setError(null);
    try {
      await pricingAction({ type: "set_price", planId: plan.id, inrPaise, usdCents });
      onDone();
    } catch (err) {
      setError(err instanceof AdminApiError || err instanceof Error ? err.message : "Failed to save");
      setConfirming(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">India price (₹)</label>
          <input type="number" min={1} step="1" value={inr} onChange={(e) => setInr(e.target.value)} className="input" />
          <p className="mt-1 text-xs text-muted">Now {rupees(plan.price_inr_paise)}</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">International price ($)</label>
          <input type="number" min={1} step="0.01" value={usd} onChange={(e) => setUsd(e.target.value)} className="input" />
          <p className="mt-1 text-xs text-muted">Now {dollars(plan.price_usd_cents)}</p>
        </div>
      </div>
      {valid && !unchanged && (
        <p className="text-xs text-muted">
          {Number(inr) / plan.included_minutes > 0 && `₹${(Number(inr) / plan.included_minutes).toFixed(2)}/min`} ·{" "}
          {`$${(Number(usd) / plan.included_minutes).toFixed(3)}/min`} for {plan.included_minutes} minutes
        </p>
      )}
      <p className="text-xs text-muted">
        Goes live on the website within a minute. Prices written into page text (FAQs, comparison pages) don&apos;t
        change automatically — ask for those to be updated if this is a permanent change.
      </p>

      {error && <p className="text-sm text-danger">{error}</p>}

      {confirming ? (
        <div className="rounded-lg border border-warn/40 bg-warn/5 p-3">
          <p className="text-sm text-ink">
            Change {plan.display_name} from {rupees(plan.price_inr_paise)} / {dollars(plan.price_usd_cents)} to{" "}
            <strong>
              {rupees(inrPaise)} / {dollars(usdCents)}
            </strong>
            ?
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn-primary flex-1" disabled={loading} onClick={save}>
              {loading ? "Saving..." : "Yes, change price"}
            </button>
            <button type="button" className="btn-secondary flex-1" onClick={() => setConfirming(false)}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn-primary w-full" disabled={!valid || unchanged} onClick={() => setConfirming(true)}>
          Review change
        </button>
      )}
    </div>
  );
}
