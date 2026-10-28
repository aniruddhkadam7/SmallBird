"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Copy, FileText, Loader2, Plus, Sparkles, Trash2 } from "lucide-react"
import { LiquidButton } from "@/components/ui/liquid-glass-button"
import { createResume, deleteResume, duplicateResume } from "@/lib/resume/api"
import { starterResume, type ResumeRow } from "@/lib/resume/types"
import { RESUME_LIMITS, type PlanId } from "@/lib/plans"

export type ResumeListItem = Pick<ResumeRow, "id" | "title" | "data" | "updated_at">

function formatUpdated(iso: string) {
  const date = new Date(iso)
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days < 1 && new Date().getDate() === date.getDate()) {
    return `Today, ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
  }
  if (days < 2) return "Yesterday"
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })
}

export function ResumesList({
  resumes: initial,
  name,
  email,
  planId,
  planName,
}: {
  resumes: ResumeListItem[]
  name: string
  email: string
  planId: string
  planName: string
}) {
  const router = useRouter()
  const [resumes, setResumes] = useState(initial)
  const limits = RESUME_LIMITS[planId as PlanId] ?? RESUME_LIMITS.free
  const atLimit = limits.maxResumes !== null && resumes.length >= limits.maxResumes

  // /resume/new sends people here with ?limit=1 when their plan's resume limit stopped it.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("limit") === "1") {
      setError(
        `Your plan lets you keep ${limits.maxResumes ?? "a limited number of"} resumes. Delete one, or upgrade to Pro for unlimited resumes.`,
      )
    }
  }, [limits.maxResumes])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await task()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  const createNew = () =>
    run("new", async () => {
      const id = await createResume("Untitled resume", starterResume(name, email))
      router.push(`/resume/${id}`)
    })

  const duplicate = (row: ResumeListItem) =>
    run(`copy:${row.id}`, async () => {
      const id = await duplicateResume(row)
      setResumes((list) => [{ ...row, id, title: `${row.title} (copy)`, updated_at: new Date().toISOString() }, ...list])
    })

  const remove = (row: ResumeListItem) => {
    if (!window.confirm(`Delete "${row.title}"? This can't be undone.`)) return
    run(`delete:${row.id}`, async () => {
      await deleteResume(row.id)
      setResumes((list) => list.filter((r) => r.id !== row.id))
    })
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Resumes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Build a clean resume, import your old one, and tailor it to each job with AI.
          </p>
        </div>
        <LiquidButton size="sm" className="w-full sm:w-auto" onClick={createNew} disabled={busy === "new"}>
          {busy === "new" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          New resume
        </LiquidButton>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">{planName}:</span>{" "}
          {limits.maxResumes === null
            ? `${resumes.length} resumes (unlimited)`
            : `${resumes.length} of ${limits.maxResumes} resumes used`}{" "}
          · {limits.aiPerDay} AI actions a day
        </span>
        {limits.maxResumes !== null && (
          <a href="/pricing" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
            {atLimit ? "Limit reached — get unlimited with Pro" : "Get more with Pro"}
          </a>
        )}
      </div>

      {error && <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {resumes.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/10">
            <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </span>
          <div className="font-semibold text-foreground">No resumes yet</div>
          <p className="max-w-md text-sm text-muted-foreground">
            Start a new resume. You can type it in, or import your old PDF/DOCX and let AI fill everything in. Then paste a
            job description and AI tailors it to that job, without making anything up.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {resumes.map((row) => (
            <div key={row.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
              <button type="button" onClick={() => router.push(`/resume/${row.id}`)} className="flex items-start gap-3 text-left">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                  <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-foreground">{row.title}</span>
                  <span className="block truncate text-sm text-muted-foreground">{row.data?.name || "No name yet"}</span>
                </span>
              </button>
              <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
                <span className="text-xs text-muted-foreground">Edited {formatUpdated(row.updated_at)}</span>
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => duplicate(row)}
                    disabled={busy !== null}
                    aria-label="Duplicate"
                    title="Duplicate"
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                  >
                    {busy === `copy:${row.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(row)}
                    disabled={busy !== null}
                    aria-label="Delete"
                    title="Delete"
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push(`/resume/${row.id}`)}
                    className="ml-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/10"
                  >
                    Open
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
