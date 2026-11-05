"use client";

import { useState } from "react";
import { AdminApiError } from "@/lib/adminApi";
import {
  isoToLocalInput,
  localInputToIso,
  pricingAction,
  when,
  windowStatus,
  type PromotionRow,
  type Theme,
} from "@/lib/pricing";
import { ThemePicker } from "@/components/pricing/ThemePicker";

// Website announcement ("ad"): a strip above the top menu and/or a popup a
// moment after a visitor lands, on the marketing pages, with an optional
// festive decoration (Diwali, New Year, confetti). Each visitor can close
// it; a new announcement shows to everyone again. The newest live one wins
// if several overlap. Start from a template or reuse a past announcement.

type ShowAs = "banner" | "popup" | "both";

interface Draft {
  title: string;
  message: string;
  ctaLabel: string;
  ctaHref: string;
  showAs: ShowAs;
  theme: Theme;
}

const EMPTY: Draft = { title: "", message: "", ctaLabel: "See offers", ctaHref: "/pricing", showAs: "banner", theme: "none" };

const TEMPLATES: { name: string; draft: Draft }[] = [
  {
    name: "🪔 Diwali Sale",
    draft: {
      title: "🪔 Diwali Sale",
      message: "Up to 50% off all SmallBird AI passes — this Diwali only",
      ctaLabel: "See offers",
      ctaHref: "/pricing",
      showAs: "both",
      theme: "diwali",
    },
  },
  {
    name: "🎆 New Year Sale",
    draft: {
      title: "🎆 New Year Sale",
      message: "Start the year with your dream job — special prices on all passes",
      ctaLabel: "See offers",
      ctaHref: "/pricing",
      showAs: "both",
      theme: "newyear",
    },
  },
  {
    name: "⚡ Flash Sale",
    draft: {
      title: "⚡ Flash Sale",
      message: "Today only: extra savings on every pass",
      ctaLabel: "Grab the deal",
      ctaHref: "/pricing",
      showAs: "banner",
      theme: "confetti",
    },
  },
  {
    name: "🎓 Placement Season",
    draft: {
      title: "🎓 Placement Season Offer",
      message: "Interviews coming up? Practise and ace them with SmallBird AI",
      ctaLabel: "See passes",
      ctaHref: "/pricing",
      showAs: "banner",
      theme: "none",
    },
  },
  {
    name: "📣 Product news",
    draft: {
      title: "📣 New in SmallBird AI",
      message: "",
      ctaLabel: "Download",
      ctaHref: "/download",
      showAs: "banner",
      theme: "none",
    },
  },
];

const BANNER_PREVIEW: Record<Theme, string> = {
  none: "bg-ink text-surface",
  diwali: "bg-gradient-to-r from-[#7c2d12] via-[#c2410c] to-[#9d174d] text-[#FFF4D6]",
  newyear: "bg-gradient-to-r from-[#0f172a] via-[#312e81] to-[#0f172a] text-[#FDE68A]",
  confetti: "bg-gradient-to-r from-[#4361EE] via-[#7209B7] to-[#F72585] text-white",
};

function fromRow(p: PromotionRow): Draft {
  return {
    title: p.title,
    message: p.message ?? "",
    ctaLabel: p.cta_label ?? "",
    ctaHref: p.cta_href ?? "",
    showAs: p.show_banner && p.show_popup ? "both" : p.show_popup ? "popup" : "banner",
    theme: p.theme ?? "none",
  };
}

function errorText(err: unknown, fallback: string) {
  return err instanceof AdminApiError || err instanceof Error ? err.message : fallback;
}

export function AnnouncementPanel({ promotions, onChanged }: { promotions: PromotionRow[]; onChanged: () => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  // Set while editing an existing announcement in place.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [startNow, setStartNow] = useState(true);
  const [startsAt, setStartsAt] = useState("");
  const [noEnd, setNoEnd] = useState(false);
  const [endsAt, setEndsAt] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const startIso = startNow ? null : localInputToIso(startsAt);
  const endIso = noEnd ? null : localInputToIso(endsAt);
  const problems = [
    !draft.title.trim() && "Write a headline.",
    Boolean(draft.ctaLabel.trim()) !== Boolean(draft.ctaHref.trim()) && "Set both button text and link, or clear both.",
    draft.ctaHref.trim() && !draft.ctaHref.startsWith("/") && !draft.ctaHref.startsWith("https://") && "Button link must start with / or https://",
    !startNow && !startsAt && "Pick a start time, or start now.",
    !noEnd && !endsAt && "Pick an end time, or choose 'Until I remove it'.",
  ].filter(Boolean) as string[];

  const current = promotions.filter((p) => windowStatus(p.starts_at, p.ends_at) !== "ended");
  const past = promotions.filter((p) => windowStatus(p.starts_at, p.ends_at) === "ended").slice(0, 10);

  function resetForm() {
    setDraft(EMPTY);
    setEditingId(null);
    setStartNow(true);
    setStartsAt("");
    setNoEnd(false);
    setEndsAt("");
  }

  function applyTemplate(d: Draft) {
    setDraft(d);
    setEditingId(null);
    setNotice(null);
  }

  function reuse(p: PromotionRow) {
    setDraft(fromRow(p));
    setEditingId(null);
    setStartNow(true);
    setStartsAt("");
    setNoEnd(false);
    setEndsAt("");
    setNotice(`Copied "${p.title}" — set new dates and publish.`);
  }

  function edit(p: PromotionRow) {
    setDraft(fromRow(p));
    setEditingId(p.id);
    const started = Date.parse(p.starts_at) <= Date.now();
    setStartNow(started);
    setStartsAt(started ? "" : isoToLocalInput(p.starts_at));
    setNoEnd(!p.ends_at);
    setEndsAt(isoToLocalInput(p.ends_at));
    setNotice(`Editing "${p.title}" — save to update it on the website.`);
  }

  async function run(body: Record<string, unknown>, fallback: string, after?: () => void) {
    setLoading(true);
    setError(null);
    try {
      await pricingAction(body);
      after?.();
      onChanged();
    } catch (err) {
      setError(errorText(err, fallback));
    } finally {
      setLoading(false);
    }
  }

  function publish() {
    const editingRow = editingId ? promotions.find((p) => p.id === editingId) : null;
    run(
      {
        type: editingId ? "update_promotion" : "save_promotion",
        id: editingId ?? undefined,
        title: draft.title.trim(),
        message: draft.message.trim() || null,
        ctaLabel: draft.ctaLabel.trim() || null,
        ctaHref: draft.ctaHref.trim() || null,
        showBanner: draft.showAs !== "popup",
        showPopup: draft.showAs !== "banner",
        theme: draft.theme,
        // An announcement already running keeps its original start.
        startsAt: editingRow && startNow ? editingRow.starts_at : startIso,
        endsAt: endIso,
      },
      editingId ? "Failed to save" : "Failed to publish",
      () => {
        setNotice(editingId ? "Saved — the website updates within a minute." : "Published — it shows on the website within a minute.");
        resetForm();
      },
    );
  }

  return (
    <section className="card space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-ink">Website announcement</h2>
        <p className="mt-1 text-xs text-muted">
          A banner above the top menu and/or a popup on smallbirdai.com — for a sale, a launch, or any news — with an optional
          festive decoration. Shows within about a minute.
        </p>
      </div>

      {current.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">On the website now</p>
          <ul className="space-y-2">
            {current.map((p) => (
              <PromotionItem
                key={p.id}
                promo={p}
                loading={loading}
                editing={editingId === p.id}
                confirmingDelete={confirmDelete === p.id}
                onReuse={() => reuse(p)}
                onEdit={() => edit(p)}
                onEnd={() => run({ type: "end_promotion", id: p.id }, "Failed to end it")}
                onDelete={() =>
                  confirmDelete === p.id
                    ? run({ type: "delete_promotion", id: p.id }, "Failed to delete", () => setConfirmDelete(null))
                    : setConfirmDelete(p.id)
                }
              />
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">{editingId ? "Editing" : "Start from a template"}</p>
        {editingId ? (
          <button type="button" className="btn-secondary" onClick={() => { resetForm(); setNotice(null); }}>
            Cancel editing
          </button>
        ) : (
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((t) => (
              <button key={t.name} type="button" className="btn-secondary" onClick={() => applyTemplate(t.draft)}>
                {t.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {notice && <p className="rounded-lg bg-accent/10 px-3 py-2 text-sm text-ink">{notice}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-muted">Headline</label>
          <input value={draft.title} maxLength={120} onChange={(e) => set("title", e.target.value)} className="input" placeholder="🪔 Diwali Sale is live" />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-muted">Message (optional)</label>
          <input value={draft.message} maxLength={300} onChange={(e) => set("message", e.target.value)} className="input" placeholder="30% off all passes until Sunday" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Button text (optional)</label>
          <input value={draft.ctaLabel} maxLength={40} onChange={(e) => set("ctaLabel", e.target.value)} className="input" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Button link</label>
          <input value={draft.ctaHref} onChange={(e) => set("ctaHref", e.target.value)} className="input" placeholder="/pricing" />
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
          <button key={k} type="button" onClick={() => set("showAs", k)} className={draft.showAs === k ? "btn-primary" : "btn-secondary"}>
            {text}
          </button>
        ))}
      </div>

      <ThemePicker value={draft.theme} onChange={(t) => set("theme", t)} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Starts</p>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} />{" "}
            {editingId ? "Already started / right now" : "Right now"}
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

      {draft.title.trim() && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Preview</p>
          {draft.showAs !== "popup" && (
            <div className={`rounded-md px-4 py-2 text-center text-sm ${BANNER_PREVIEW[draft.theme]}`}>
              <strong>{draft.title}</strong>
              {draft.message && <span className="opacity-80"> — {draft.message}</span>}
              {draft.ctaLabel && <span className="ml-2 font-semibold underline">{draft.ctaLabel}</span>}
            </div>
          )}
          {draft.showAs !== "banner" && (
            <div
              className={`mx-auto mt-3 max-w-xs rounded-xl border p-5 text-center shadow-card ${
                draft.theme === "diwali" ? "border-[#F59E0B]/50 bg-gradient-to-b from-[#FFF4E0] to-[#FFE3EC]" : "border-border bg-surface"
              }`}
            >
              {draft.theme === "diwali" && <p className="mb-1 text-2xl">🪔</p>}
              <p className={`text-lg font-semibold ${draft.theme === "diwali" ? "text-[#7C2D12]" : "text-ink"}`}>{draft.title}</p>
              {draft.message && <p className="mt-1 text-sm text-muted">{draft.message}</p>}
              {draft.ctaLabel && <span className="btn-primary mt-3 inline-block">{draft.ctaLabel}</span>}
            </div>
          )}
        </div>
      )}

      {problems.length > 0 && draft.title.trim() && (
        <ul className="list-inside list-disc text-xs text-warn">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}

      <button type="button" className="btn-primary w-full sm:w-auto" disabled={loading || problems.length > 0} onClick={publish}>
        {loading ? "Saving..." : editingId ? "Save changes" : startNow ? "Publish now" : "Schedule"}
      </button>

      {past.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Past announcements — reuse any of them</p>
          <ul className="space-y-2">
            {past.map((p) => (
              <PromotionItem
                key={p.id}
                promo={p}
                loading={loading}
                confirmingDelete={confirmDelete === p.id}
                onReuse={() => reuse(p)}
                onDelete={() =>
                  confirmDelete === p.id
                    ? run({ type: "delete_promotion", id: p.id }, "Failed to delete", () => setConfirmDelete(null))
                    : setConfirmDelete(p.id)
                }
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function PromotionItem({
  promo: p,
  loading,
  editing,
  confirmingDelete,
  onReuse,
  onEdit,
  onEnd,
  onDelete,
}: {
  promo: PromotionRow;
  loading: boolean;
  editing?: boolean;
  confirmingDelete: boolean;
  onReuse: () => void;
  onEdit?: () => void;
  onEnd?: () => void;
  onDelete: () => void;
}) {
  const status = windowStatus(p.starts_at, p.ends_at);
  const badge =
    status === "live"
      ? ["Live", "bg-ok/10 text-ok"]
      : status === "scheduled"
        ? [`Starts ${when(p.starts_at)}`, "bg-warn/10 text-warn"]
        : [`Ended ${when(p.ends_at)}`, "bg-ink/5 text-muted"];
  return (
    <li className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm ${editing ? "border-accent" : "border-border"}`}>
      <div className="min-w-0">
        <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-semibold ${badge[1]}`}>{badge[0]}</span>
        <strong>{p.title}</strong>
        {p.message ? <span className="text-muted"> — {p.message}</span> : null}
        <span className="block text-xs text-muted">
          {[p.show_banner && "Banner", p.show_popup && "Popup"].filter(Boolean).join(" + ")}
          {p.theme && p.theme !== "none" ? ` · ${p.theme} decoration` : ""}
          {status !== "ended" ? ` · ${p.ends_at ? `until ${when(p.ends_at)}` : "until removed"}` : ""}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="btn-secondary" disabled={loading} onClick={onReuse}>
          Reuse
        </button>
        {onEdit && (
          <button type="button" className="btn-secondary" disabled={loading} onClick={onEdit}>
            Edit
          </button>
        )}
        {onEnd && (
          <button type="button" className="btn-secondary" disabled={loading} onClick={onEnd}>
            {status === "live" ? "End now" : "Cancel"}
          </button>
        )}
        <button type="button" className={confirmingDelete ? "btn-danger" : "btn-secondary"} disabled={loading} onClick={onDelete}>
          {confirmingDelete ? "Confirm delete" : "Delete"}
        </button>
      </div>
    </li>
  );
}
