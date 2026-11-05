"use client";

import { useMemo, useState } from "react";
import { AdminApiError } from "@/lib/adminApi";
import {
  dollars,
  localInputToIso,
  percentOff,
  pricingAction,
  rupees,
  saleStatus,
  when,
  windowStatus,
  type PlanRow,
  type PromotionRow,
  type Theme,
} from "@/lib/pricing";
import { ThemePicker } from "@/components/pricing/ThemePicker";

type DiscountKind = "percent" | "flat" | "exact";

const LABEL_IDEAS = ["🪔 Diwali Sale", "🎉 New Year Sale", "⚡ Flash Sale", "🎓 Placement Season Offer", "🛍️ Weekend Sale"];

// Largest price ending in 9 rupees that isn't above `paise` (₹239.20 -> ₹239,
// ₹447.20 -> ₹439); whole dollars for USD ($7.20 -> $7).
function niceInr(paise: number): number {
  const r = Math.floor(paise / 100);
  const nine = Math.floor((r - 9) / 10) * 10 + 9;
  return (nine >= 9 ? nine : r) * 100;
}
function niceUsd(cents: number): number {
  const d = Math.floor(cents / 100);
  return (d >= 1 ? d : cents / 100) * 100;
}

function errorText(err: unknown, fallback: string) {
  return err instanceof AdminApiError || err instanceof Error ? err.message : fallback;
}

export function SalePanel({
  plans,
  promotions,
  onChanged,
}: {
  plans: PlanRow[];
  promotions: PromotionRow[];
  onChanged: () => void;
}) {
  const paid = plans.filter((p) => p.price_inr_paise > 0 && p.is_active);
  const onSale = paid.filter((p) => ["live", "scheduled"].includes(saleStatus(p)));

  const [selected, setSelected] = useState<string[]>(paid.map((p) => p.id));
  const [kind, setKind] = useState<DiscountKind>("percent");
  const [percent, setPercent] = useState("20");
  const [flatInr, setFlatInr] = useState("50");
  const [flatUsd, setFlatUsd] = useState("2");
  const [exact, setExact] = useState<Record<string, { inr: string; usd: string }>>({});
  const [india, setIndia] = useState(true);
  const [international, setInternational] = useState(true);
  const [rounded, setRounded] = useState(true);
  const [label, setLabel] = useState("🪔 Diwali Sale");
  const [startNow, setStartNow] = useState(true);
  const [startsAt, setStartsAt] = useState("");
  const [noEnd, setNoEnd] = useState(false);
  const [endsAt, setEndsAt] = useState("");
  const [announce, setAnnounce] = useState(true);
  const [announceAs, setAnnounceAs] = useState<"banner" | "popup" | "both">("both");
  const [theme, setTheme] = useState<Theme>("diwali");
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(
    () =>
      paid
        .filter((p) => selected.includes(p.id))
        .map((p) => {
          let inr: number | null = null;
          let usd: number | null = null;
          if (kind === "percent") {
            const f = 1 - Number(percent) / 100;
            inr = Math.round(p.price_inr_paise * f);
            usd = Math.round(p.price_usd_cents * f);
          } else if (kind === "flat") {
            inr = p.price_inr_paise - Math.round(Number(flatInr) * 100);
            usd = p.price_usd_cents - Math.round(Number(flatUsd) * 100);
          } else {
            const e = exact[p.id];
            inr = e?.inr ? Math.round(Number(e.inr) * 100) : null;
            usd = e?.usd ? Math.round(Number(e.usd) * 100) : null;
          }
          if (rounded && kind !== "exact") {
            inr = inr !== null ? niceInr(inr) : null;
            usd = usd !== null ? niceUsd(usd) : null;
          }
          if (!india) inr = null;
          if (!international) usd = null;
          const inrOk = inr === null || (inr > 0 && inr < p.price_inr_paise);
          const usdOk = usd === null || (usd > 0 && usd < p.price_usd_cents);
          return { plan: p, inr, usd, ok: inrOk && usdOk && (inr !== null || usd !== null) };
        }),
    [paid, selected, kind, percent, flatInr, flatUsd, exact, rounded, india, international],
  );

  const startIso = startNow ? null : localInputToIso(startsAt);
  const endIso = noEnd ? null : localInputToIso(endsAt);
  const maxOff = Math.max(
    0,
    ...preview.map((r) => Math.round((1 - (r.inr ?? r.plan.price_inr_paise) / r.plan.price_inr_paise) * 100)),
  );
  const problems = [
    preview.length === 0 && "Pick at least one plan.",
    !india && !international && "Choose India, international, or both.",
    preview.some((r) => !r.ok) && "Every sale price must be above 0 and below the regular price.",
    !label.trim() && "Give the sale a name.",
    !startNow && !startsAt && "Pick a start time, or start now.",
    !noEnd && !endsAt && "Pick an end time, or choose 'Until I end it'.",
    endIso && Date.parse(endIso) <= Math.max(Date.now(), startIso ? Date.parse(startIso) : 0) && "The end time must be after the start.",
  ].filter(Boolean) as string[];

  async function start() {
    setLoading(true);
    setError(null);
    try {
      await pricingAction({
        type: "start_sale",
        label: label.trim(),
        startsAt: startIso,
        endsAt: endIso,
        plans: preview.map((r) => ({ planId: r.plan.id, inrPaise: r.inr, usdCents: r.usd })),
      });
      if (announce) {
        await pricingAction({
          type: "save_promotion",
          title: label.trim(),
          message: `${kind === "percent" ? `${Number(percent)}% off` : `Up to ${maxOff}% off`} SmallBird AI passes${
            endIso ? ` — ends ${new Date(endIso).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""
          }`,
          ctaLabel: "See offers",
          ctaHref: "/pricing",
          showBanner: announceAs !== "popup",
          showPopup: announceAs !== "banner",
          theme,
          startsAt: startIso,
          endsAt: endIso,
        });
      }
      setConfirming(false);
      onChanged();
    } catch (err) {
      setError(errorText(err, "Failed to start the sale"));
      setConfirming(false);
    } finally {
      setLoading(false);
    }
  }

  // Announcements (banner, popup, decoration) showing on the website now.
  // They're separate from the sale itself, so ending the sale on every plan
  // offers to take them down too -- otherwise the site keeps advertising it.
  const liveAnnouncements = promotions.filter((p) => windowStatus(p.starts_at, p.ends_at) !== "ended");
  const [alsoEndAnnouncements, setAlsoEndAnnouncements] = useState(true);

  async function endSale(planIds?: string[]) {
    setLoading(true);
    setError(null);
    try {
      await pricingAction({ type: "end_sale", planIds });
      if (!planIds && alsoEndAnnouncements) {
        for (const promo of liveAnnouncements) await pricingAction({ type: "end_promotion", id: promo.id });
      }
      onChanged();
    } catch (err) {
      setError(errorText(err, "Failed to end the sale"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-ink">Sales & discounts</h2>
        <p className="mt-1 text-xs text-muted">
          Shows a lower price on the website with the regular price struck through and the sale name. When the sale
          ends, regular prices come back by themselves.
        </p>
      </div>

      {onSale.length > 0 && (
        <div className="rounded-lg border border-ok/40 bg-ok/5 p-3">
          <p className="text-sm font-semibold text-ink">Current sale</p>
          <ul className="mt-2 space-y-1 text-sm">
            {onSale.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>{p.display_name}</strong> — {p.sale_label}: {rupees(p.sale_price_inr_paise)} /{" "}
                  {dollars(p.sale_price_usd_cents)}{" "}
                  <span className="text-xs text-muted">
                    ({saleStatus(p) === "scheduled" ? `starts ${when(p.sale_starts_at)}, ` : ""}
                    {p.sale_ends_at ? `ends ${when(p.sale_ends_at)}` : "until ended"})
                  </span>
                </span>
                <button type="button" className="btn-secondary" disabled={loading} onClick={() => endSale([p.id])}>
                  End for this plan
                </button>
              </li>
            ))}
          </ul>
          {liveAnnouncements.length > 0 && (
            <label className="mt-3 flex items-start gap-1.5 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={alsoEndAnnouncements}
                onChange={(e) => setAlsoEndAnnouncements(e.target.checked)}
              />
              <span>
                Also take down the website announcement ({liveAnnouncements.map((p) => p.title).join(", ")}) — its banner,
                popup and festive decoration
              </span>
            </label>
          )}
          <button type="button" className="btn-danger mt-3" disabled={loading} onClick={() => endSale()}>
            End sale on all plans now
          </button>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">1. Which plans</p>
        <div className="flex flex-wrap gap-2">
          {paid.map((p) => (
            <label key={p.id} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...s, p.id] : s.filter((id) => id !== p.id)))}
              />
              {p.display_name}
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">2. Discount</p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["percent", "% off"],
              ["flat", "Flat amount off"],
              ["exact", "Set exact sale prices"],
            ] as const
          ).map(([k, text]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={kind === k ? "btn-primary" : "btn-secondary"}
            >
              {text}
            </button>
          ))}
        </div>
        <div className="mt-3">
          {kind === "percent" && (
            <div className="flex items-center gap-2">
              <input type="number" min={1} max={90} value={percent} onChange={(e) => setPercent(e.target.value)} className="input w-24" />
              <span className="text-sm text-muted">% off</span>
              {["10", "20", "30", "50"].map((v) => (
                <button key={v} type="button" className="btn-secondary" onClick={() => setPercent(v)}>
                  {v}%
                </button>
              ))}
            </div>
          )}
          {kind === "flat" && (
            <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
              <div>
                <label className="mb-1 block text-xs text-muted">₹ off (India)</label>
                <input type="number" min={1} value={flatInr} onChange={(e) => setFlatInr(e.target.value)} className="input" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">$ off (international)</label>
                <input type="number" min={1} step="0.5" value={flatUsd} onChange={(e) => setFlatUsd(e.target.value)} className="input" />
              </div>
            </div>
          )}
          {kind === "exact" && (
            <div className="space-y-2">
              {paid
                .filter((p) => selected.includes(p.id))
                .map((p) => (
                  <div key={p.id} className="grid grid-cols-[8rem_1fr_1fr] items-center gap-2">
                    <span className="text-sm">{p.display_name}</span>
                    <input
                      type="number"
                      placeholder={`₹ (now ${p.price_inr_paise / 100})`}
                      value={exact[p.id]?.inr ?? ""}
                      onChange={(e) => setExact((x) => ({ ...x, [p.id]: { inr: e.target.value, usd: x[p.id]?.usd ?? "" } }))}
                      className="input"
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder={`$ (now ${p.price_usd_cents / 100})`}
                      value={exact[p.id]?.usd ?? ""}
                      onChange={(e) => setExact((x) => ({ ...x, [p.id]: { inr: x[p.id]?.inr ?? "", usd: e.target.value } }))}
                      className="input"
                    />
                  </div>
                ))}
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={india} onChange={(e) => setIndia(e.target.checked)} /> India (₹)
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={international} onChange={(e) => setInternational(e.target.checked)} /> International ($)
          </label>
          {kind !== "exact" && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={rounded} onChange={(e) => setRounded(e.target.checked)} /> Round to tidy prices (₹239, $7)
            </label>
          )}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">3. Sale name (shown on the website)</p>
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} className="input sm:max-w-sm" />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {LABEL_IDEAS.map((idea) => (
            <button key={idea} type="button" className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-subtle" onClick={() => setLabel(idea)}>
              {idea}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">4. Starts</p>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} /> Right now
          </label>
          {!startNow && <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="input mt-2" />}
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">5. Back to regular prices</p>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={noEnd} onChange={(e) => setNoEnd(e.target.checked)} /> Until I end it
          </label>
          {!noEnd && <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="input mt-2" />}
        </div>
      </div>

      <div>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} /> Also announce it on the
          website
        </label>
        {announce && (
          <div className="mt-3">
            <ThemePicker value={theme} onChange={setTheme} />
          </div>
        )}
        {announce && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(
              [
                ["banner", "Top banner"],
                ["popup", "Popup"],
                ["both", "Banner + popup"],
              ] as const
            ).map(([k, text]) => (
              <button key={k} type="button" onClick={() => setAnnounceAs(k)} className={announceAs === k ? "btn-primary" : "btn-secondary"}>
                {text}
              </button>
            ))}
          </div>
        )}
      </div>

      {preview.length > 0 && (
        <div className="overflow-x-auto">
          <p className="mb-1.5 text-xs font-medium text-muted">Preview</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-1.5 pr-3 font-medium">Plan</th>
                <th className="py-1.5 pr-3 font-medium">India</th>
                <th className="py-1.5 font-medium">International</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {preview.map((r) => (
                <tr key={r.plan.id} className={r.ok ? "" : "text-danger"}>
                  <td className="py-1.5 pr-3">{r.plan.display_name}</td>
                  <td className="py-1.5 pr-3">
                    {r.inr === null ? (
                      <span className="text-muted">{rupees(r.plan.price_inr_paise)} (no sale)</span>
                    ) : (
                      <>
                        <s className="text-muted">{rupees(r.plan.price_inr_paise)}</s> → <strong>{rupees(r.inr)}</strong>{" "}
                        <span className="text-xs text-ok">{percentOff(r.plan.price_inr_paise, r.inr)}</span>
                      </>
                    )}
                  </td>
                  <td className="py-1.5">
                    {r.usd === null ? (
                      <span className="text-muted">{dollars(r.plan.price_usd_cents)} (no sale)</span>
                    ) : (
                      <>
                        <s className="text-muted">{dollars(r.plan.price_usd_cents)}</s> → <strong>{dollars(r.usd)}</strong>{" "}
                        <span className="text-xs text-ok">{percentOff(r.plan.price_usd_cents, r.usd)}</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {problems.length > 0 && (
        <ul className="list-inside list-disc text-xs text-warn">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}

      {confirming ? (
        <div className="rounded-lg border border-warn/40 bg-warn/5 p-3">
          <p className="text-sm text-ink">
            Start <strong>{label.trim()}</strong> on {preview.length} plan{preview.length === 1 ? "" : "s"},{" "}
            {startNow ? "right now" : `from ${when(startIso)}`}, {noEnd ? "until you end it" : `ending ${when(endIso)}`}
            {announce ? `, with a website ${announceAs === "both" ? "banner and popup" : announceAs}` : ""}?
            {onSale.length > 0 && " This replaces the current sale."}
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn-primary flex-1" disabled={loading} onClick={start}>
              {loading ? "Starting..." : "Yes, start sale"}
            </button>
            <button type="button" className="btn-secondary flex-1" onClick={() => setConfirming(false)}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn-primary w-full sm:w-auto" disabled={problems.length > 0} onClick={() => setConfirming(true)}>
          Review sale
        </button>
      )}
    </section>
  );
}
