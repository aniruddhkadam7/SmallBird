"use client"

import { useMemo, useState } from "react"
import { Briefcase, Download, LayoutGrid, List, MessageSquareText, Search, X } from "lucide-react"
import ReactMarkdown from "react-markdown"
import { LiquidButton } from "@/components/ui/liquid-glass-button"

interface Turn {
  question: string
  answer: string
}

interface Transcript {
  id: string
  started_at_ms: number
  ended_at_ms: number
  role: string | null
  company: string | null
  turns: Turn[]
}

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()
}

function formatDuration(startedMs: number, endedMs: number) {
  const totalSeconds = Math.max(0, Math.round((endedMs - startedMs) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}

/// Plain-text transcript for the Download action — readable on its own
/// outside the browser (a text editor, pasted into an email, etc.), with the
/// same Q&A structure as the on-screen modal.
function transcriptText(transcript: Transcript): string {
  const title = [transcript.role, transcript.company].filter(Boolean).join(" · ") || "Interview"
  const lines = [
    title,
    `${formatDate(transcript.started_at_ms)} · ${formatDuration(transcript.started_at_ms, transcript.ended_at_ms)}`,
    "",
  ]
  transcript.turns.forEach((turn) => {
    lines.push("Interviewer:", turn.question, "", "Smallbird:", turn.answer, "")
  })
  return lines.join("\n")
}

function downloadTranscript(transcript: Transcript) {
  const blob = new Blob([transcriptText(transcript)], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  const safeTitle = (transcript.role || transcript.company || "interview").replace(/[^\w-]+/g, "_")
  a.href = url
  a.download = `${safeTitle}-${transcript.id}.txt`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function TranscriptModal({ transcript, onClose }: { transcript: Transcript; onClose: () => void }) {
  const title = [transcript.role, transcript.company].filter(Boolean).join(" · ") || "Interview"
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="font-semibold text-foreground">{title}</div>
            <div className="text-xs text-muted-foreground">{formatDate(transcript.started_at_ms)}</div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => downloadTranscript(transcript)}
              aria-label="Download transcript"
              title="Download transcript"
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <Download className="h-4 w-4" />
              Download
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-5 overflow-y-auto px-5 py-5">
          {transcript.turns.map((turn, i) => (
            <div key={i} className="flex flex-col gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0">
              <div className="rounded-lg border border-border bg-foreground/[0.03] px-3.5 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Interviewer</div>
                <p className="mt-1 text-sm text-foreground">{turn.question}</p>
              </div>
              <div className="rounded-lg border border-blue-500/25 bg-blue-500/[0.07] px-3.5 py-3 dark:border-blue-400/25 dark:bg-blue-400/[0.08]">
                <div className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                  Smallbird
                </div>
                <div className="prose prose-sm prose-neutral dark:prose-invert mt-1 max-w-none text-sm leading-relaxed text-foreground [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_code]:text-[0.85em]">
                  <ReactMarkdown>{turn.answer}</ReactMarkdown>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function InterviewCard({ transcript, onView }: { transcript: Transcript; onView: () => void }) {
  const title = [transcript.role, transcript.company].filter(Boolean).join(" · ") || "Interview"

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{formatDate(transcript.started_at_ms)}</div>
      <div className="font-semibold text-foreground">{title}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 rounded-full bg-foreground/10 px-2 py-1 text-xs font-medium text-foreground">
          <Briefcase className="h-3 w-3" />
          Interview
        </span>
        <span className="flex items-center gap-1 rounded-full bg-foreground/10 px-2 py-1 text-xs font-medium text-foreground">
          <MessageSquareText className="h-3 w-3" />
          {transcript.turns.length} question{transcript.turns.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
          Ended · {formatDuration(transcript.started_at_ms, transcript.ended_at_ms)}
        </div>
        <button
          type="button"
          onClick={onView}
          className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/10"
        >
          View Transcript
        </button>
      </div>
    </div>
  )
}

type Tab = "all" | "active" | "ended"

export function InterviewsList({ transcripts }: { transcripts: Transcript[] }) {
  const [tab, setTab] = useState<Tab>("all")
  const [query, setQuery] = useState("")
  const [view, setView] = useState<"grid" | "list">("grid")
  const [viewing, setViewing] = useState<Transcript | null>(null)

  const filtered = useMemo(() => {
    if (tab === "active") return []
    const q = query.trim().toLowerCase()
    if (!q) return transcripts
    return transcripts.filter((t) => `${t.role ?? ""} ${t.company ?? ""}`.toLowerCase().includes(q))
  }, [transcripts, tab, query])

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Interviews</h1>
          <p className="mt-1 text-sm text-muted-foreground">Prepare for interviews and review past sessions.</p>
        </div>
        <LiquidButton size="sm" className="w-full sm:w-auto" onClick={() => (window.location.href = "/download")}>
          Open Desktop App
        </LiquidButton>
      </div>

      <div className="mt-8 flex flex-col gap-2 border-b border-border sm:flex-row sm:items-center sm:justify-between sm:gap-0">
        <div className="flex gap-4 overflow-x-auto sm:gap-6">
          {(["all", "active", "ended"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`shrink-0 border-b-2 pb-3 text-sm font-medium capitalize transition-colors ${
                tab === t ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="pb-3 text-xs text-muted-foreground">
          {filtered.length} Session{filtered.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by role or company"
            className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="flex rounded-md border border-border">
          <button
            type="button"
            onClick={() => setView("grid")}
            aria-label="Grid view"
            className={`p-2 ${view === "grid" ? "bg-foreground/10 text-foreground" : "text-muted-foreground"}`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            aria-label="List view"
            className={`border-l border-border p-2 ${view === "list" ? "bg-foreground/10 text-foreground" : "text-muted-foreground"}`}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-16 text-center text-sm text-muted-foreground">
          {tab === "active"
            ? "Nothing in progress — interviews only appear here once completed in the desktop app."
            : "No interviews yet. Once you complete a session in the desktop app while signed in, it'll show up here."}
        </p>
      ) : (
        <div className={`mt-6 grid gap-4 ${view === "grid" ? "sm:grid-cols-2" : "grid-cols-1"}`}>
          {filtered.map((t) => (
            <InterviewCard key={t.id} transcript={t} onView={() => setViewing(t)} />
          ))}
        </div>
      )}

      {viewing && <TranscriptModal transcript={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
