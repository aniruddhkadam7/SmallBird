"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { ChevronRight, ExternalLink, FileText, X } from "lucide-react";
import { ResumeViewer } from "@/components/resume/ResumeViewer";
import { createClient } from "@/lib/supabase/client";
import { Unauthorized } from "@/components/Unauthorized";
import { PageLoading } from "@/components/PageLoading";
import { formatJoined } from "@/lib/format";

// How people use the website's resume builder (smallbird.in/resume): who uses
// it, how much, which AI actions, and per person the resumes they built and
// the CVs / JDs they gave the AI. Reads admin_resume_builder_stats and
// admin_user_resume_builder (migration 0052) straight from the browser; both
// check the caller is an admin themselves.

interface Stats {
  totalUsers: number;
  builderUsers: number;
  resumes: number;
  usersWithResume: number;
  aiActions: number;
  aiUsers: number;
  activeUsers7d: number;
  newUsers7d: number;
  aiCostUsd: number;
  byAction: { action: string; count: number; users: number }[];
  daily: { day: string; resumesCreated: number; aiActions: number; users: number }[];
  users: {
    userId: string;
    email: string;
    planId: string | null;
    resumes: number;
    aiActions: number;
    jdCount: number;
    // AI feature -> how many times they used it (migration 0055).
    actions?: Record<string, number>;
    // India-time days (YYYY-MM-DD) they used the builder on.
    days?: string[];
    firstUsed: string;
    lastActive: string;
  }[];
}

// What the People list is narrowed to, picked by tapping a tile or a chart.
type Filter =
  | { kind: "resumes" }
  | { kind: "ai" }
  | { kind: "active7d" }
  | { kind: "day"; day: string }
  | { kind: "action"; action: string };

type BuilderUser = Stats["users"][number];

const WEEK_MS = 7 * 86_400_000;

function matches(u: BuilderUser, f: Filter): boolean {
  switch (f.kind) {
    case "resumes":
      return u.resumes > 0;
    case "ai":
      return u.aiActions > 0;
    case "active7d":
      return Date.now() - new Date(u.lastActive).getTime() <= WEEK_MS;
    case "day":
      return (u.days ?? []).includes(f.day);
    case "action":
      return (u.actions?.[f.action] ?? 0) > 0;
  }
}

const shortDay = (day: string) => new Date(day).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

function filterLabel(f: Filter): string {
  switch (f.kind) {
    case "resumes":
      return "Saved a resume";
    case "ai":
      return "Used the AI";
    case "active7d":
      return "Active in the last 7 days";
    case "day":
      return `Used it on ${shortDay(f.day)}`;
    case "action":
      return actionLabel(f.action);
  }
}

const sameFilter = (a: Filter | null, b: Filter) => JSON.stringify(a) === JSON.stringify(b);

interface ResumeData {
  name?: string;
  tagline?: string;
  contact?: { label?: string; value?: string }[];
  sections?: {
    title?: string;
    kind?: string;
    text?: string;
    entries?: { heading?: string; headingRight?: string; subheading?: string; subheadingRight?: string; items?: string[] }[];
    rows?: { label?: string; value?: string }[];
  }[];
}

interface UserDetail {
  resumes: { id: string; title: string; data: ResumeData; createdAt: string; updatedAt: string }[];
  requests: {
    id: string;
    action: string;
    uploadedText: string | null;
    uploadedFilePath?: string | null;
    uploadedFileName?: string | null;
    jobDescription: string | null;
    instructions: string | null;
    inputText: string | null;
    // The AI's reply: import -> the resume; tailor/edit -> { resume, changes,
    // missingSkills? }; rewrite -> { text }; improve -> { items }.
    result: Record<string, unknown> | null;
    createdAt: string;
  }[];
  versions: {
    id: string;
    resumeId: string;
    title: string;
    data: ResumeData;
    createdAt: string;
    savedAt: string;
    deleted: boolean;
  }[];
  desktopDocs: {
    transcriptId: string;
    sessionAt: string;
    role: string | null;
    company: string | null;
    docType: string;
    filename: string;
    text: string;
  }[];
}

const ACTION_LABELS: Record<string, string> = {
  import: "Imported an old CV",
  tailor: "Tailored to a JD",
  improve: "Improved an entry",
  edit: "Edited with a request",
  rewrite: "Rewrote a line",
};

const actionLabel = (a: string) => ACTION_LABELS[a] ?? a;

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().rpc(name, args);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data as T;
}

function pct(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%";
}

function Tile({
  label,
  value,
  sub,
  active,
  onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`card text-left transition hover:border-accent/40 hover:shadow-md active:scale-[0.98] ${active ? "!border-accent ring-1 ring-accent" : ""}`}
    >
      <p className="flex items-center justify-between gap-1 text-xs font-medium text-muted">
        {label}
        <ChevronRight size={14} className="text-muted/60" aria-hidden />
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </button>
  );
}

// People who used the builder each day, last 30 days. One series, so no
// legend; each bar's tooltip has the day's numbers, and a tap lists that
// day's people. The whole column is the tap target, so short bars are easy
// to hit.
function DailyBars({ daily, selected, onPick }: { daily: Stats["daily"]; selected: string | null; onPick: (day: string) => void }) {
  const max = Math.max(1, ...daily.map((d) => d.users));
  return (
    <div>
      <div className="flex h-32 items-end gap-[3px]">
        {daily.map((d) => (
          <button
            key={d.day}
            disabled={!d.users}
            onClick={() => onPick(d.day)}
            className="group flex h-full flex-1 items-end rounded-t disabled:cursor-default"
            title={`${shortDay(d.day)}: ${d.users} people, ${d.aiActions} AI actions, ${d.resumesCreated} new resumes`}
            aria-label={`${shortDay(d.day)}: ${d.users} people`}
          >
            <span
              className={`block w-full rounded-t transition-colors ${
                selected === d.day ? "bg-accent" : selected ? "bg-accent/30 group-hover:bg-accent/60" : "bg-accent/80 group-hover:bg-accent"
              }`}
              style={{ height: `${d.users ? Math.max((d.users / max) * 100, 4) : 0}%` }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        <span>{daily[0] ? shortDay(daily[0].day) : ""}</span>
        <span>today</span>
      </div>
    </div>
  );
}

// Opens the original upload from the private resume-uploads bucket (0054)
// through a 5-minute signed URL. The tab is opened before the request so the
// browser doesn't block it as a pop-up.
async function openOriginal(path: string) {
  const tab = window.open("", "_blank");
  const { data, error } = await createClient().storage.from("resume-uploads").createSignedUrl(path, 300);
  if (error || !data) {
    tab?.close();
    alert(`Couldn't open the file: ${error?.message ?? "unknown error"}`);
    return;
  }
  if (tab) tab.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
}

function TextBlock({ label, text, filePath }: { label: string; text: string; filePath?: string | null }) {
  return (
    <details className="group rounded-lg border border-border px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm">
        <span className="font-medium text-ink">{label}</span>
        {filePath && (
          <button
            onClick={(e) => {
              e.preventDefault();
              openOriginal(filePath);
            }}
            className="ml-auto inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs font-medium text-accent hover:bg-subtle"
          >
            Open original file <ExternalLink size={12} />
          </button>
        )}
        <span className="text-xs text-accent group-open:hidden">Show</span>
        <span className="hidden text-xs text-accent group-open:inline">Hide</span>
      </summary>
      <p className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap text-sm text-ink">{text}</p>
    </details>
  );
}

// "30 Oct, 3:45 pm" -- the timeline needs the time on older days too.
function when(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

// A resume as a row; "Open CV" shows it on an A4 sheet in its template.
function ResumeBlock({ label, data, note }: { label: string; data: ResumeData; note?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
      <span className="min-w-0">
        <span className="font-medium text-ink">{label}</span>
        {note && <span className="ml-2 text-xs text-muted">{note}</span>}
      </span>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs font-medium text-accent hover:bg-subtle"
      >
        <FileText size={12} /> Open CV
      </button>
      {open && <ResumeViewer title={label} subtitle={note} data={data} onClose={() => setOpen(false)} />}
    </div>
  );
}

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// What the AI gave back for one action.
function AiResult({ action, result }: { action: string; result: Record<string, unknown> | null }) {
  if (!result) return <p className="text-xs text-muted">AI reply not saved (from before 30 Oct, or it failed).</p>;
  if (action === "import") return <ResumeBlock label="CV the AI built from it" data={result as ResumeData} />;
  if (action === "rewrite") return <TextBlock label="AI rewrote it to" text={String(result.text ?? "")} />;
  if (action === "improve") return <TextBlock label="AI rewrote it to" text={asStrings(result.items).map((i) => `• ${i}`).join("\n")} />;
  const changes = asStrings(result.changes);
  const missing = asStrings(result.missingSkills);
  return (
    <div className="space-y-1.5">
      {!!result.resume && <ResumeBlock label="CV the AI generated" data={result.resume as ResumeData} />}
      {changes.length > 0 && <TextBlock label={`What the AI changed (${changes.length})`} text={changes.map((c) => `• ${c}`).join("\n")} />}
      {missing.length > 0 && <TextBlock label={`Skills the JD wants that the CV lacks (${missing.length})`} text={missing.join(", ")} />}
    </div>
  );
}

const DESKTOP_DOC_LABELS: Record<string, string> = { RESUME: "CV", JOB_DESCRIPTION: "Job description" };

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-muted">{children}</p>;
}

function UserPanel({ userId }: { userId: string }) {
  const { data, error } = useSWR(["admin_user_resume_builder", userId], () =>
    rpc<UserDetail>("admin_user_resume_builder", { p_user_id: userId }),
  );
  if (error) return <p className="text-sm text-danger">Couldn&apos;t load: {error.message}</p>;
  if (!data) return <p className="text-sm text-muted">Loading...</p>;

  // Everything they did while building, newest first: each AI action and
  // each saved stretch of work on a resume.
  const timeline = [
    ...data.requests.map((q) => ({ kind: "ai" as const, at: q.createdAt, q })),
    ...(data.versions ?? []).map((v) => ({ kind: "save" as const, at: v.savedAt, v })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const uploads = [
    ...data.requests
      .filter((q) => q.uploadedText)
      .map((q) => ({
        id: q.id,
        at: q.createdAt,
        label: `CV uploaded to the resume builder${q.uploadedFileName ? ` (${q.uploadedFileName})` : ""}`,
        text: q.uploadedText!,
        filePath: q.uploadedFilePath,
      })),
    ...data.requests
      .filter((q) => q.jobDescription)
      .map((q) => ({
        id: `${q.id}-jd`,
        at: q.createdAt,
        label: `JD used to ${q.action} in the resume builder`,
        text: q.jobDescription!,
        filePath: null,
      })),
    ...(data.desktopDocs ?? []).map((d, i) => ({
      id: `${d.transcriptId}-${i}`,
      at: d.sessionAt,
      label: `${DESKTOP_DOC_LABELS[d.docType] ?? d.docType} in a desktop session${d.role || d.company ? ` (${[d.role, d.company].filter(Boolean).join(", ")})` : ""}`,
      text: d.text,
      filePath: null,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    // The same JD is often sent with several actions in a row.
    .filter((u, i, all) => all.findIndex((x) => x.text === u.text) === i);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="space-y-2">
          <SectionTitle>Resumes now ({data.resumes.length})</SectionTitle>
          {data.resumes.length === 0 && <p className="text-sm text-muted">No saved resumes (deleted, or only used the AI).</p>}
          {data.resumes.map((r) => (
            <ResumeBlock key={r.id} label={r.title} data={r.data} note={`updated ${formatJoined(r.updatedAt)}`} />
          ))}
        </div>
        <div className="space-y-2">
          <SectionTitle>CVs & JDs they uploaded ({uploads.length})</SectionTitle>
          {uploads.length === 0 && <p className="text-sm text-muted">None saved yet. Kept from 30 Oct 2026 on.</p>}
          {uploads.map((u) => (
            <TextBlock key={u.id} label={`${u.label} · ${when(u.at)}`} text={u.text} filePath={u.filePath} />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <SectionTitle>How they built it ({timeline.length})</SectionTitle>
        {timeline.length === 0 && <p className="text-sm text-muted">No history yet.</p>}
        <ol className="space-y-2 border-l-2 border-border pl-3">
          {timeline.map((t) =>
            t.kind === "ai" ? (
              <li key={t.q.id} className="space-y-1.5 rounded-lg bg-subtle px-3 py-2">
                <p className="flex justify-between gap-2 text-sm">
                  <span className="font-medium text-ink">AI · {actionLabel(t.q.action)}</span>
                  <span className="flex-shrink-0 text-xs text-muted">{when(t.at)}</span>
                </p>
                {t.q.instructions && <p className="text-sm text-ink">They asked: &ldquo;{t.q.instructions}&rdquo;</p>}
                {t.q.uploadedText && (
                  <TextBlock label="CV they uploaded" text={t.q.uploadedText} filePath={t.q.uploadedFilePath} />
                )}
                {t.q.jobDescription && <TextBlock label="Job description" text={t.q.jobDescription} />}
                {t.q.inputText && <TextBlock label="What they asked to change" text={t.q.inputText} />}
                <AiResult action={t.q.action} result={t.q.result} />
              </li>
            ) : (
              <li key={t.v.id} className="space-y-1.5 rounded-lg border border-border px-3 py-2">
                <p className="flex justify-between gap-2 text-sm">
                  <span className="font-medium text-ink">
                    Saved &ldquo;{t.v.title}&rdquo;
                    {t.v.deleted && <span className="badge badge-muted ml-2">deleted later</span>}
                  </span>
                  <span className="flex-shrink-0 text-xs text-muted">{when(t.at)}</span>
                </p>
                <ResumeBlock label="The resume at this point" data={t.v.data} note={`edited ${when(t.v.createdAt)} – ${when(t.v.savedAt)}`} />
              </li>
            ),
          )}
        </ol>
      </div>
    </div>
  );
}

// One person's resume builder use, in a large dialog over the page.
function UserModal({ user, onClose }: { user: Stats["users"][number]; onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // The CV viewer on top handles its own Escape.
      if (e.key === "Escape" && !document.querySelector("[data-resume-viewer]")) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-6" onClick={onClose}>
      <div
        className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        style={{ height: "min(92vh, 100%)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-ink">{user.email}</p>
            <p className="text-xs text-muted">
              {user.resumes} resumes · {user.aiActions} AI actions · {user.jdCount} JDs · first used {formatJoined(user.firstUsed)} · last used{" "}
              {formatJoined(user.lastActive)}
            </p>
            <Link href={`/users/${user.userId}`} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
              Open user profile <ExternalLink size={12} />
            </Link>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <span className={`badge ${user.planId && user.planId !== "free" ? "badge-ok" : "badge-muted"}`}>{user.planId ?? "free"}</span>
            <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-ink" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <UserPanel userId={user.userId} />
        </div>
      </div>
    </div>
  );
}

export default function ResumeBuilderPage() {
  const { data: s, error } = useSWR("admin_resume_builder_stats", () => rpc<Stats>("admin_resume_builder_stats"));
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter | null>(null);
  const peopleRef = useRef<HTMLElement>(null);

  if ((error as { code?: string } | undefined)?.code === "42501") return <Unauthorized />;
  if (!s) return <PageLoading error={error} />;

  const openUser = s.users.find((u) => u.userId === open);
  const maxAction = Math.max(1, ...s.byAction.map((a) => a.count));
  const people = filter ? s.users.filter((u) => matches(u, filter)) : s.users;

  // Tapping the active filter again clears it; a new one scrolls to the list.
  const pick = (f: Filter | null) => {
    const next = f && !sameFilter(filter, f) ? f : null;
    setFilter(next);
    if (next) requestAnimationFrame(() => peopleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Resume Builder</h1>
        <p className="text-sm text-muted">Who uses the resume builder on the website, and how.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="People who used it"
          value={s.builderUsers}
          sub={`${pct(s.builderUsers, s.totalUsers)} of all ${s.totalUsers} users`}
          active={filter === null}
          onClick={() => pick(null)}
        />
        <Tile
          label="Resumes saved"
          value={s.resumes}
          sub={`by ${s.usersWithResume} people`}
          active={sameFilter(filter, { kind: "resumes" })}
          onClick={() => pick({ kind: "resumes" })}
        />
        <Tile
          label="AI actions"
          value={s.aiActions}
          sub={`by ${s.aiUsers} people · $${Number(s.aiCostUsd).toFixed(2)}`}
          active={sameFilter(filter, { kind: "ai" })}
          onClick={() => pick({ kind: "ai" })}
        />
        <Tile
          label="Active in last 7 days"
          value={s.activeUsers7d}
          sub={`${s.newUsers7d} used it for the first time`}
          active={sameFilter(filter, { kind: "active7d" })}
          onClick={() => pick({ kind: "active7d" })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-4 text-sm font-semibold text-ink">People using it per day · last 30 days</h2>
          <DailyBars
            daily={s.daily}
            selected={filter?.kind === "day" ? filter.day : null}
            onPick={(day) => pick({ kind: "day", day })}
          />
          <p className="mt-2 text-[11px] text-muted">Tap a bar to see who used it that day.</p>
        </section>
        <section className="card">
          <h2 className="mb-4 text-sm font-semibold text-ink">Which AI features they use</h2>
          {s.byAction.length === 0 && <p className="text-sm text-muted">No AI actions yet.</p>}
          <ul className="-mx-2 space-y-1">
            {s.byAction.map((a) => {
              const active = sameFilter(filter, { kind: "action", action: a.action });
              return (
                <li key={a.action}>
                  <button
                    onClick={() => pick({ kind: "action", action: a.action })}
                    className={`block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-subtle ${active ? "bg-accent/10" : ""}`}
                  >
                    <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                      <span className={active ? "font-medium text-accent" : "text-ink"}>{actionLabel(a.action)}</span>
                      <span className="flex items-center gap-1 tabular-nums text-ink">
                        <span className="font-semibold">{a.count}</span>
                        <span className="text-xs text-muted">by {a.users} people</span>
                        <ChevronRight size={13} className="text-muted/60" aria-hidden />
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-ink/[0.06]">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${(a.count / maxAction) * 100}%` }} />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section ref={peopleRef} className="scroll-mt-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-ink">
            People ({people.length}
            {filter ? ` of ${s.users.length}` : ""})
          </h2>
          {filter && (
            <button
              onClick={() => setFilter(null)}
              className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent hover:bg-accent/20"
            >
              {filterLabel(filter)} <X size={12} />
            </button>
          )}
        </div>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-card">
          {people.map((u) => (
              <li key={u.userId}>
                <button
                  onClick={() => setOpen(u.userId)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-subtle"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{u.email}</span>
                    <span className="block text-xs text-muted">
                      {u.resumes} resumes · {u.aiActions} AI actions · {u.jdCount} JDs · last used {formatJoined(u.lastActive)}
                    </span>
                  </span>
                  <span className={`badge ${u.planId && u.planId !== "free" ? "badge-ok" : "badge-muted"}`}>
                    {u.planId ?? "free"}
                  </span>
                  <ChevronRight size={16} className="flex-shrink-0 text-muted" />
                </button>
              </li>
          ))}
          {people.length === 0 && (
            <li className="py-8 text-center text-sm text-muted">
              {filter ? "Nobody matches this filter." : "Nobody has used the resume builder yet."}
            </li>
          )}
        </ul>
      </section>
      {openUser && <UserModal user={openUser} onClose={() => setOpen(null)} />}
    </div>
  );
}
