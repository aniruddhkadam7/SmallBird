"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { ChevronDown, ExternalLink } from "lucide-react";
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
    firstUsed: string;
    lastActive: string;
  }[];
}

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

function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

// People who used the builder each day, last 30 days. One series, so no
// legend; each bar's tooltip has the day's numbers.
function DailyBars({ daily }: { daily: Stats["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.users));
  return (
    <div>
      <div className="flex h-32 items-end gap-[3px]">
        {daily.map((d) => (
          <div
            key={d.day}
            className="flex-1 rounded-t bg-accent/80 hover:bg-accent"
            style={{ height: `${d.users ? Math.max((d.users / max) * 100, 4) : 0}%` }}
            title={`${new Date(d.day).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}: ${d.users} people, ${d.aiActions} AI actions, ${d.resumesCreated} new resumes`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        <span>{new Date(daily[0]?.day).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
        <span>today</span>
      </div>
    </div>
  );
}

function ResumeView({ data }: { data: ResumeData }) {
  return (
    <div className="space-y-3 text-sm text-ink">
      <div>
        <p className="text-base font-semibold">{data.name || "No name"}</p>
        {data.tagline && <p className="text-muted">{data.tagline}</p>}
        {!!data.contact?.length && (
          <p className="text-xs text-muted">{data.contact.map((c) => c.value).filter(Boolean).join(" · ")}</p>
        )}
      </div>
      {data.sections?.map((s, i) => (
        <div key={i}>
          <p className="border-b border-border pb-0.5 text-xs font-semibold uppercase tracking-wide text-muted">{s.title}</p>
          {s.kind === "text" && <p className="mt-1 whitespace-pre-wrap">{s.text}</p>}
          {s.kind === "table" && (
            <ul className="mt-1 space-y-0.5">
              {s.rows?.map((r, j) => (
                <li key={j}>
                  <span className="font-medium">{r.label}:</span> {r.value}
                </li>
              ))}
            </ul>
          )}
          {s.kind === "entries" &&
            s.entries?.map((e, j) => (
              <div key={j} className="mt-1.5">
                <p className="flex justify-between gap-3">
                  <span className="font-medium">{e.heading}</span>
                  <span className="text-xs text-muted">{e.headingRight}</span>
                </p>
                {(e.subheading || e.subheadingRight) && (
                  <p className="flex justify-between gap-3 text-xs text-muted">
                    <span>{e.subheading}</span>
                    <span>{e.subheadingRight}</span>
                  </p>
                )}
                {!!e.items?.length && (
                  <ul className="ml-4 list-disc">
                    {e.items.map((it, k) => (
                      <li key={k}>{it.replace(/\*\*/g, "")}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
        </div>
      ))}
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

function ResumeBlock({ label, data, note }: { label: string; data: ResumeData; note?: string }) {
  return (
    <details className="group rounded-lg border border-border bg-surface px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm">
        <span className="min-w-0">
          <span className="font-medium text-ink">{label}</span>
          {note && <span className="ml-2 text-xs text-muted">{note}</span>}
        </span>
        <span className="text-xs text-accent group-open:hidden">Show</span>
        <span className="hidden text-xs text-accent group-open:inline">Hide</span>
      </summary>
      <div className="mt-3 max-h-[32rem] overflow-y-auto">
        <ResumeView data={data ?? {}} />
      </div>
    </details>
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


export default function ResumeBuilderPage() {
  const { data: s, error } = useSWR("admin_resume_builder_stats", () => rpc<Stats>("admin_resume_builder_stats"));
  const [open, setOpen] = useState<string | null>(null);

  if ((error as { code?: string } | undefined)?.code === "42501") return <Unauthorized />;
  if (!s) return <PageLoading error={error} />;

  const maxAction = Math.max(1, ...s.byAction.map((a) => a.count));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Resume Builder</h1>
        <p className="text-sm text-muted">Who uses the resume builder on the website, and how.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="People who used it" value={s.builderUsers} sub={`${pct(s.builderUsers, s.totalUsers)} of all ${s.totalUsers} users`} />
        <Tile label="Resumes saved" value={s.resumes} sub={`by ${s.usersWithResume} people`} />
        <Tile label="AI actions" value={s.aiActions} sub={`by ${s.aiUsers} people · $${Number(s.aiCostUsd).toFixed(2)}`} />
        <Tile label="Active in last 7 days" value={s.activeUsers7d} sub={`${s.newUsers7d} used it for the first time`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-4 text-sm font-semibold text-ink">People using it per day · last 30 days</h2>
          <DailyBars daily={s.daily} />
        </section>
        <section className="card">
          <h2 className="mb-4 text-sm font-semibold text-ink">Which AI features they use</h2>
          {s.byAction.length === 0 && <p className="text-sm text-muted">No AI actions yet.</p>}
          <ul className="space-y-2">
            {s.byAction.map((a) => (
              <li key={a.action}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-ink">{actionLabel(a.action)}</span>
                  <span className="tabular-nums text-ink">
                    <span className="font-semibold">{a.count}</span>
                    <span className="ml-1 text-xs text-muted">by {a.users} people</span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-ink/[0.06]">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(a.count / maxAction) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">People ({s.users.length})</h2>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-card">
          {s.users.map((u) => {
            const isOpen = open === u.userId;
            return (
              <li key={u.userId}>
                <button
                  onClick={() => setOpen(isOpen ? null : u.userId)}
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
                  <ChevronDown size={16} className={`flex-shrink-0 text-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <div className="space-y-3 border-t border-border bg-subtle/40 px-4 py-4">
                    <Link href={`/users/${u.userId}`} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                      Open user <ExternalLink size={12} />
                    </Link>
                    <UserPanel userId={u.userId} />
                  </div>
                )}
              </li>
            );
          })}
          {s.users.length === 0 && <li className="py-8 text-center text-sm text-muted">Nobody has used the resume builder yet.</li>}
        </ul>
      </section>
    </div>
  );
}
