"use client";

import { useState } from "react";
import { AdminApiError } from "@/lib/adminApi";
import { localInputToIso, pricingAction, when, windowStatus, type PromotionRow } from "@/lib/pricing";

// Website announcement ("ad"): a strip above the top menu and/or a popup a
// moment after a visitor lands, on the marketing pages. Each visitor can
// close it; a new announcement shows to everyone again. The newest live one
// wins if several overlap.
export function AnnouncementPanel({ promotions, onChanged }: { promotions: PromotionRow[]; onChanged: () => void }) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [ctaLabel, setCtaLabel] = useState("See offers");
  const [ctaHref, setCtaHref] = useState("/pricing");
  const [showAs, setShowAs] = useState<"banner" | "popup" | "both">("banner");
  const [startNow, setStartNow] = useState(true);
  const [startsAt, setStartsAt] = useState("");
  const [noEnd, setNoEnd] = useState(false);
  const [endsAt, setEndsAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startIso = startNow ? null : localInputToIso(startsAt);
  const endIso = noEnd ? null : localInputToIso(endsAt);
  const problems = [
    !title.trim() && "Write a headline.",
    Boolean(ctaLabel.trim()) !== Boolean(ctaHref.trim()) && "Set both button text and link, or clear both.",
    ctaHref.trim() && !ctaHref.startsWith("/") && !ctaHref.startsWith("https://") && "Button link must start with / or https://",
    !startNow && !startsAt && "Pick a start time, or start now.",
    !noEnd && !endsAt && "Pick an end time, or choose 'Until I remove it'.",
  ].filter(Boolean) as string[];

  const visible = promotions.filter((p) => windowStatus(p.starts_at, p.ends_at) !== "ended");
  const past = promotions.filter((p) => windowStatus(p.starts_at, p.ends_at) === "ended").slice(0, 5);

  async function publish() {
    setLoading(true);
    setError(null);
    try {
      await pricingAction({
        type: "save_promotion",
        title: title.trim(),
        message: message.trim() || null,
        ctaLabel: ctaLabel.trim() || null,
        ctaHref: ctaHref.trim() || null,
        showBanner: showAs !== "popup",
        showPopup: showAs !== "banner",
        startsAt: startIso,
        endsAt: endIso,
      });
      setTitle("");
      setMessage("");
      onChanged();
    } catch (err) {
      setError(err instanceof AdminApiError || err instanceof Error ? err.message : "Failed to publish");
    } finally {
      setLoading(false);
    }
  }

  async function end(id: string) {
    setLoading(true);
    setError(null);
    try {
      await pricingAction({ type: "end_promotion", id });
      onChanged();
    } catch (err) {
      setError(err instanceof AdminApiError || err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-ink">Website announcement</h2>
        <p className="mt-1 text-xs text-muted">
          A banner above the top menu and/or a popup on smallbirdai.com — for a sale, a launch, or any news. Shows within
          about a minute.
        </p>
      </div>

      {visible.length > 0 && (
        <ul className="space-y-2">
          {visible.map((p) => {
            const status = windowStatus(p.starts_at, p.ends_at);
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                <div>
                  <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-semibold ${status === "live" ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn"}`}>
                    {status === "live" ? "Live" : `Starts ${when(p.starts_at)}`}
                  </span>
                  <strong>{p.title}</strong>
                  {p.message ? <span className="text-muted"> — {p.message}</span> : null}
                  <span className="block text-xs text-muted">
                    {[p.show_banner && "Banner", p.show_popup && "Popup"].filter(Boolean).join(" + ")} ·{" "}
                    {p.ends_at ? `until ${when(p.ends_at)}` : "until removed"}
                  </span>
                </div>
                <button type="button" className="btn-secondary" disabled={loading} onClick={() => end(p.id)}>
                  {status === "live" ? "Remove now" : "Cancel"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-muted">Headline</label>
          <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="🪔 Diwali Sale is live" />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-muted">Message (optional)</label>
          <input value={message} maxLength={300} onChange={(e) => setMessage(e.target.value)} className="input" placeholder="30% off all passes until Sunday" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Button text (optional)</label>
          <input value={ctaLabel} maxLength={40} onChange={(e) => setCtaLabel(e.target.value)} className="input" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Button link</label>
          <input value={ctaHref} onChange={(e) => setCtaHref(e.target.value)} className="input" placeholder="/pricing" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["banner", "Top banner"],
            ["popup", "Popup"],
            ["both", "Banner + popup"],
          ] as const
        ).map(([k, text]) => (
          <button key={k} type="button" onClick={() => setShowAs(k)} className={showAs === k ? "btn-primary" : "btn-secondary"}>
            {text}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Starts</p>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} /> Right now
          </label>
          {!startNow && <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="input mt-2" />}
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Ends</p>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={noEnd} onChange={(e) => setNoEnd(e.target.checked)} /> Until I remove it
          </label>
          {!noEnd && <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="input mt-2" />}
        </div>
      </div>

      {title.trim() && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Preview</p>
          {showAs !== "popup" && (
            <div className="rounded-md bg-ink px-4 py-2 text-center text-sm text-surface">
              <strong>{title}</strong>
              {message && <span className="opacity-80"> — {message}</span>}
              {ctaLabel && <span className="ml-2 font-semibold underline">{ctaLabel}</span>}
            </div>
          )}
          {showAs !== "banner" && (
            <div className="mx-auto mt-3 max-w-xs rounded-xl border border-border bg-surface p-5 text-center shadow-card">
              <p className="text-lg font-semibold text-ink">{title}</p>
              {message && <p className="mt-1 text-sm text-muted">{message}</p>}
              {ctaLabel && <span className="btn-primary mt-3 inline-block">{ctaLabel}</span>}
            </div>
          )}
        </div>
      )}

      {problems.length > 0 && title.trim() && (
        <ul className="list-inside list-disc text-xs text-warn">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}

      <button type="button" className="btn-primary w-full sm:w-auto" disabled={loading || problems.length > 0} onClick={publish}>
        {loading ? "Publishing..." : startNow ? "Publish now" : "Schedule"}
      </button>

      {past.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Recently ended</p>
          <ul className="space-y-1 text-xs text-muted">
            {past.map((p) => (
              <li key={p.id}>
                {p.title} · ended {when(p.ends_at)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
