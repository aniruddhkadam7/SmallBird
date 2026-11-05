"use client";

import { useState } from "react";
import { useAdminQuery } from "@/lib/useAdminQuery";
import { AdminApiError } from "@/lib/adminApi";
import {
  campaignAction,
  dollars,
  rupees,
  saleStatus,
  when,
  type Audience,
  type CampaignData,
  type CampaignRow,
  type PlanRow,
} from "@/lib/pricing";

// Email an offer to your users: pick who, write (or fill in from the running
// sale), send yourself a test, then send. Only confirmed, un-banned users
// who haven't unsubscribed are ever emailed, each campaign reaches a person
// at most once, and every email has an unsubscribe link.

const AUDIENCES: { id: Audience; label: string; hint: string }[] = [
  { id: "all", label: "Everyone", hint: "all users" },
  { id: "free", label: "Free-plan users", hint: "haven't bought a pass yet — best for a sale" },
  { id: "non_buyers", label: "Never bought", hint: "no purchase so far" },
  { id: "buyers", label: "Past buyers", hint: "have bought a pass" },
];

interface Draft {
  name: string;
  subject: string;
  headline: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
}

const EMPTY: Draft = { name: "", subject: "", headline: "", body: "", ctaLabel: "See the offer", ctaHref: "/pricing" };

function errorText(err: unknown, fallback: string) {
  return err instanceof AdminApiError || err instanceof Error ? err.message : fallback;
}

// Text for an email about the sale that's running now.
function draftFromSale(plans: PlanRow[]): Draft | null {
  const onSale = plans.filter((p) => saleStatus(p) === "live");
  if (onSale.length === 0) return null;
  const label = onSale[0].sale_label ?? "Sale";
  const endsAt = onSale.map((p) => p.sale_ends_at).find(Boolean) ?? null;
  const lines = onSale.map((p) => {
    const inr = p.sale_price_inr_paise ? `${rupees(p.sale_price_inr_paise)} (was ${rupees(p.price_inr_paise)})` : null;
    const usd = p.sale_price_usd_cents ? `${dollars(p.sale_price_usd_cents)} (was ${dollars(p.price_usd_cents)})` : null;
    return `• ${p.display_name} — ${p.included_minutes} minutes: ${[inr, usd].filter(Boolean).join(" / ")}`;
  });
  const maxOff = Math.max(
    ...onSale.map((p) =>
      p.sale_price_inr_paise ? Math.round((1 - p.sale_price_inr_paise / p.price_inr_paise) * 100) : 0,
    ),
  );
  const ends = endsAt ? ` The offer ends ${when(endsAt)}.` : "";
  return {
    name: label,
    subject: `${label}: ${maxOff ? `up to ${maxOff}% off` : "special prices"} on SmallBird AI`,
    headline: `${label} is on — ${maxOff ? `up to ${maxOff}% off` : "special prices"}`,
    body: `Got an interview coming up? Our passes are on sale right now:\n\n${lines.join("\n")}\n\nPasses never expire — use your minutes whenever your interview is.${ends}`,
    ctaLabel: "Get the offer",
    ctaHref: "/pricing",
  };
}

export function EmailCampaignPanel({ plans }: { plans: PlanRow[] }) {
  const { data, error: loadError, mutate } = useAdminQuery<CampaignData>("admin-campaign", { type: "get" });
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [audience, setAudience] = useState<Audience>("free");
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{ sent: number; failed: number; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const saleDraft = draftFromSale(plans);
  const count = data?.counts[audience] ?? 0;
  const resumable = data?.campaigns.find((c) => c.status === "sending") ?? null;

  const problems = [
    !draft.name.trim() && "Give the campaign a name (only you see it).",
    !draft.subject.trim() && "Write the subject line.",
    !draft.headline.trim() && "Write a headline.",
    !draft.body.trim() && "Write the message.",
    Boolean(draft.ctaLabel.trim()) !== Boolean(draft.ctaHref.trim()) && "Set both button text and link, or clear both.",
    draft.ctaHref.trim() && !draft.ctaHref.startsWith("/") && !draft.ctaHref.startsWith("https://") && "Button link must start with / or https://",
  ].filter(Boolean) as string[];

  const content = () => ({
    subject: draft.subject.trim(),
    headline: draft.headline.trim(),
    body: draft.body.trim(),
    ctaLabel: draft.ctaLabel.trim() || null,
    ctaHref: draft.ctaHref.trim() || null,
  });

  async function sendTest() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await campaignAction<{ to: string }>({ type: "send_test", ...content() });
      setNotice(`Test email sent to ${res.to}. Check your inbox (and spam folder) before sending to everyone.`);
    } catch (err) {
      setError(errorText(err, "Couldn't send the test"));
    } finally {
      setLoading(false);
    }
  }

  // Sends batch after batch until nobody is left. Safe to call again for a
  // campaign that stopped partway (browser closed): it only sends to people
  // who haven't been emailed yet.
  async function drain(campaignId: string, total: number) {
    for (;;) {
      const res = await campaignAction<{ remaining: number; sent: number; failed: number }>({ type: "continue", campaignId });
      setProgress({ sent: res.sent, failed: res.failed, total });
      if (res.remaining === 0) return res;
    }
  }

  async function start() {
    setLoading(true);
    setError(null);
    setNotice(null);
    setConfirming(false);
    try {
      const started = await campaignAction<{ campaignId: string; recipients: number }>({
        type: "start",
        name: draft.name.trim(),
        audience,
        ...content(),
      });
      setProgress({ sent: 0, failed: 0, total: started.recipients });
      const done = await drain(started.campaignId, started.recipients);
      setNotice(`Done: ${done.sent} emails sent${done.failed ? `, ${done.failed} couldn't be delivered` : ""}.`);
      setDraft(EMPTY);
    } catch (err) {
      setError(`${errorText(err, "Sending stopped")} — press Resume under "Past campaigns" to continue; nobody will be emailed twice.`);
    } finally {
      setProgress(null);
      setLoading(false);
      void mutate();
    }
  }

  async function resume(c: CampaignRow) {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      setProgress({ sent: c.sent_count, failed: c.failed_count, total: c.recipient_count });
      const done = await drain(c.id, c.recipient_count);
      setNotice(`Finished: ${done.sent} emails sent${done.failed ? `, ${done.failed} couldn't be delivered` : ""}.`);
    } catch (err) {
      setError(errorText(err, "Sending stopped"));
    } finally {
      setProgress(null);
      setLoading(false);
      void mutate();
    }
  }

  const pct = progress && progress.total ? Math.round(((progress.sent + progress.failed) / progress.total) * 100) : 0;

  return (
    <section className="card space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-ink">Email your users about an offer</h2>
        <p className="mt-1 text-xs text-muted">
          Only users with a confirmed email who haven&apos;t unsubscribed are emailed. Every email has an unsubscribe link, and
          nobody gets the same campaign twice.
          {data ? ` ${data.unsubscribed} ${data.unsubscribed === 1 ? "person has" : "people have"} unsubscribed.` : ""}
        </p>
      </div>

      {loadError && <p className="text-sm text-danger">Couldn&apos;t load: {loadError.message}</p>}
      {data && !data.emailConfigured && (
        <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">Email sending isn&apos;t set up (RESEND_API_KEY is missing), so nothing can be sent.</p>
      )}

      {resumable && !progress && (
        <div className="rounded-lg border border-warn/40 bg-warn/5 p-3 text-sm">
          <strong>{resumable.name}</strong> didn&apos;t finish: {resumable.sent_count} of {resumable.recipient_count} sent.{" "}
          <button type="button" className="btn-secondary ml-1" disabled={loading} onClick={() => resume(resumable)}>
            Resume
          </button>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">1. Who to email</p>
        <div className="flex flex-wrap gap-2">
          {AUDIENCES.map((a) => (
            <button key={a.id} type="button" onClick={() => setAudience(a.id)} className={audience === a.id ? "btn-primary" : "btn-secondary"}>
              {a.label} {data ? `(${data.counts[a.id]})` : ""}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">{AUDIENCES.find((a) => a.id === audience)?.hint}</p>
      </div>

      <div>
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium text-muted">2. What to say</p>
          <button type="button" className="btn-secondary" disabled={!saleDraft} onClick={() => saleDraft && setDraft(saleDraft)}>
            Fill in from my current sale
          </button>
          {!saleDraft && <span className="text-xs text-muted">(no sale is running)</span>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Campaign name (only you see this)</label>
            <input value={draft.name} maxLength={80} onChange={(e) => set("name", e.target.value)} className="input" placeholder="Diwali Sale email" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Subject line</label>
            <input value={draft.subject} maxLength={150} onChange={(e) => set("subject", e.target.value)} className="input" placeholder="Diwali Sale: up to 50% off SmallBird AI" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted">Headline inside the email</label>
            <input value={draft.headline} maxLength={120} onChange={(e) => set("headline", e.target.value)} className="input" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted">Message (a blank line starts a new paragraph)</label>
            <textarea value={draft.body} maxLength={3000} rows={8} onChange={(e) => set("body", e.target.value)} className="input" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Button text</label>
            <input value={draft.ctaLabel} maxLength={40} onChange={(e) => set("ctaLabel", e.target.value)} className="input" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Button link</label>
            <input value={draft.ctaHref} onChange={(e) => set("ctaHref", e.target.value)} className="input" placeholder="/pricing" />
          </div>
        </div>
      </div>

      {draft.headline.trim() && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Preview</p>
          <div className="mx-auto max-w-md rounded-xl border border-border bg-surface p-5 shadow-card">
            <p className="text-xs font-semibold text-muted">SmallBird AI</p>
            <p className="mt-2 text-lg font-bold text-ink">{draft.headline}</p>
            <p className="mt-2 text-sm text-ink">Hi there,</p>
            <p className="mt-2 whitespace-pre-line text-sm text-ink">{draft.body}</p>
            {draft.ctaLabel && <span className="btn-primary mt-4 inline-block">{draft.ctaLabel}</span>}
            <p className="mt-4 text-[11px] text-muted">Unsubscribe from these emails</p>
          </div>
        </div>
      )}

      {problems.length > 0 && (draft.subject || draft.headline || draft.body) && (
        <ul className="list-inside list-disc text-xs text-warn">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {notice && <p className="rounded-lg bg-accent/10 px-3 py-2 text-sm text-ink">{notice}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}

      {progress && (
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-ink/10">
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-muted">
            Sending… {progress.sent} of {progress.total} sent{progress.failed ? `, ${progress.failed} failed` : ""}. Keep this page open.
          </p>
        </div>
      )}

      {confirming ? (
        <div className="rounded-lg border border-warn/40 bg-warn/5 p-3">
          <p className="text-sm text-ink">
            Email <strong>{count} {count === 1 ? "person" : "people"}</strong> ({AUDIENCES.find((a) => a.id === audience)?.label}) with the
            subject <strong>&ldquo;{draft.subject}&rdquo;</strong>? This can&apos;t be undone. Did you send yourself a test first?
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn-primary flex-1" disabled={loading || count === 0} onClick={start}>
              Yes, send to {count}
            </button>
            <button type="button" className="btn-secondary flex-1" onClick={() => setConfirming(false)}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" disabled={loading || problems.length > 0} onClick={sendTest}>
            Send a test to me
          </button>
          <button type="button" className="btn-primary" disabled={loading || problems.length > 0 || count === 0} onClick={() => setConfirming(true)}>
            Review & send to {count}
          </button>
        </div>
      )}

      {data && data.campaigns.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Past campaigns</p>
          <ul className="space-y-1.5 text-xs">
            {data.campaigns.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                <span>
                  <strong className="text-sm text-ink">{c.name}</strong>{" "}
                  <span className="text-muted">
                    · {when(c.created_at)} · {c.sent_count}/{c.recipient_count} sent{c.failed_count ? `, ${c.failed_count} failed` : ""} ·{" "}
                    {AUDIENCES.find((a) => a.id === c.audience)?.label}
                  </span>
                </span>
                {c.status === "sending" ? (
                  <button type="button" className="btn-secondary" disabled={loading} onClick={() => resume(c)}>
                    Resume
                  </button>
                ) : (
                  <span className="text-ok">Sent</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
