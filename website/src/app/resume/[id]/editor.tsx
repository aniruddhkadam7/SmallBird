"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Download,
  FileUp,
  Loader2,
  Link2,
  Plus,
  Sparkles,
  Target,
  Trash2,
  Undo2,
  Wand2,
  X,
} from "lucide-react"
import { ResumePreview } from "@/components/resume/resume-preview"
import { aiEdit, aiImport, aiImprove, aiTailor, saveResume } from "@/lib/resume/api"
import { resumeTips } from "@/lib/resume/checks"
import { readEditTarget, type EditTarget } from "@/lib/resume/edit-target"
import { sampleResume } from "@/lib/resume/sample"
import {
  emptyEntry,
  emptySection,
  isBlank,
  newId,
  type ListStyle,
  type ResumeData,
  type ResumeEntry,
  type ResumeSection,
  type SectionKind,
  type TemplateId,
  TEMPLATES,
} from "@/lib/resume/types"
import { DOCUMENT_ACCEPT, readDocument } from "@/lib/mobile/documents"
import { LineEditor } from "./line-editor"

type SaveStatus = "saved" | "pending" | "saving" | "failed"

// Same key as the dashboard's theme switch, so the editor opens in the theme
// the user picked there.
const THEME_STORAGE_KEY = "smallbird-dashboard-theme"
const SAVE_DELAY_MS = 800
// The A4 page is 210mm wide = ~794 CSS px.
const PAGE_WIDTH_PX = 794

const inputClass =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
const iconButton =
  "rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"

function move<T>(list: T[], index: number, by: number): T[] {
  const to = index + by
  if (to < 0 || to >= list.length) return list
  const next = [...list]
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}

/** Scales the A4 preview down to fit its pane (CSS zoom, so layout follows). */
function useFitScale() {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width
      if (width > 0) setScale(Math.min(1, width / PAGE_WIDTH_PX))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, scale] as const
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input className={inputClass} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function EntryEditor({
  entry,
  listStyle,
  canUp,
  canDown,
  improving,
  onChange,
  onMove,
  onRemove,
  onImprove,
}: {
  entry: ResumeEntry
  listStyle: ListStyle
  canUp: boolean
  canDown: boolean
  improving: boolean
  onChange: (entry: ResumeEntry) => void
  onMove: (by: number) => void
  onRemove: () => void
  onImprove: () => void
}) {
  const set = (patch: Partial<ResumeEntry>) => onChange({ ...entry, ...patch })
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-background/60 p-3">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <Field label="Heading" value={entry.heading} placeholder="Company / degree" onChange={(v) => set({ heading: v })} />
        <Field label="Right side" value={entry.headingRight} placeholder="Dates / college" onChange={(v) => set({ headingRight: v })} />
        <Field label="Sub-heading" value={entry.subheading} placeholder="Job title / program" onChange={(v) => set({ subheading: v })} />
        <Field label="Right side" value={entry.subheadingRight} placeholder="City / dates" onChange={(v) => set({ subheadingRight: v })} />
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          {listStyle === "bullets" ? "Bullet points" : "Lines"} <span className="font-normal">(one per line)</span>
        </span>
        <textarea
          className={`${inputClass} min-h-24 resize-y leading-relaxed`}
          value={entry.items.join("\n")}
          placeholder={listStyle === "bullets" ? "Built X using Y, which cut Z by 30%" : "Graduated with honours"}
          onChange={(e) => set({ items: e.target.value.split("\n") })}
        />
        <span className="text-xs text-muted-foreground">
          Add a link anywhere (also in the heading): paste the URL, or write [Live demo](https://your-link.com) to show just the words.
        </span>
      </label>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onImprove}
          disabled={improving || !entry.items.some((i) => i.trim())}
          className="flex items-center gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/[0.07] px-2.5 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-500/15 disabled:opacity-40 dark:text-blue-300"
        >
          {improving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Improve with AI
        </button>
        <div className="flex items-center">
          <button type="button" className={iconButton} disabled={!canUp} onClick={() => onMove(-1)} aria-label="Move entry up">
            <ChevronUp className="h-4 w-4" />
          </button>
          <button type="button" className={iconButton} disabled={!canDown} onClick={() => onMove(1)} aria-label="Move entry down">
            <ChevronDown className="h-4 w-4" />
          </button>
          <button type="button" className={iconButton} onClick={onRemove} aria-label="Delete entry">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

const TEMPLATE_LABEL_CLASS: Record<TemplateId, string> = {
  navy: "italic text-[rgb(0,54,123)] dark:text-blue-300",
  classic: "text-foreground",
  modern: "uppercase tracking-[0.12em] text-[#3e6fd8] dark:text-blue-300",
  sidebar: "text-[#1f2a5c] dark:text-indigo-300",
  bold: "text-[#2bb3e0]",
}

const TEMPLATE_FONT: Record<TemplateId, string> = {
  navy: "var(--font-resume-serif)",
  classic: "var(--font-resume-sans)",
  modern: "var(--font-resume-sans)",
  sidebar: "var(--font-resume-fira)",
  bold: "var(--font-resume-raleway)",
}

const KIND_LABEL: Record<SectionKind, string> = { text: "Paragraph", entries: "Entries", table: "Two columns" }

export function ResumeEditor({
  id,
  initialTitle,
  initialData,
}: {
  id: string
  initialTitle: string
  initialData: ResumeData
}) {
  const [theme, setTheme] = useState<"dark" | "light">("dark")
  const [title, setTitle] = useState(initialTitle)
  const [data, setData] = useState(initialData)
  const [status, setStatus] = useState<SaveStatus>("saved")
  const [undoStack, setUndoStack] = useState<ResumeData[]>([])
  const [jobDescription, setJobDescription] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [tailorInstructions, setTailorInstructions] = useState("")
  const [editRequest, setEditRequest] = useState("")
  const [tailored, setTailored] = useState(false)
  const [lineEdit, setLineEdit] = useState<{ target: EditTarget; anchor: DOMRect } | null>(null)
  const [tailorNotes, setTailorNotes] = useState<{ changes: string[]; missingSkills: string[] } | null>(null)
  const [mobileTab, setMobileTab] = useState<"edit" | "preview">("edit")
  const [previewRef, scale] = useFitScale()
  const fileInput = useRef<HTMLInputElement>(null)
  const firstRender = useRef(true)
  // What the delayed save writes: always the newest edit, not the one that scheduled it.
  const latest = useRef({ title, data })
  useEffect(() => {
    latest.current = { title, data }
  }, [title, data])

  const jdKey = `smallbird-resume-jd-${id}`
  const tailoredKey = `smallbird-resume-tailored-${id}`

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
      if (stored === "light" || stored === "dark") setTheme(stored)
      // The job description is only needed while tailoring, so it stays in
      // this browser instead of being saved with the resume.
      setJobDescription(window.localStorage.getItem(jdKey) ?? "")
      setTailored(window.localStorage.getItem(tailoredKey) === "1")
    } catch {
      // Storage blocked — defaults are fine.
    }
  }, [jdKey, tailoredKey])

  useEffect(() => {
    try {
      window.localStorage.setItem(jdKey, jobDescription)
    } catch {
      // Storage blocked — the text just isn't remembered.
    }
  }, [jdKey, jobDescription])

  const save = useCallback(async () => {
    setStatus("saving")
    try {
      await saveResume(id, latest.current.title.trim() || "Untitled resume", latest.current.data)
      setStatus("saved")
    } catch {
      setStatus("failed")
    }
  }, [id])

  // Autosave a moment after the last change.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    setStatus("pending")
    const timer = setTimeout(save, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [title, data, save])

  useEffect(() => {
    if (status === "saved") return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [status])

  const update = (fn: (draft: ResumeData) => void) =>
    setData((current) => {
      const draft = structuredClone(current)
      fn(draft)
      return draft
    })

  const updateSection = (sectionId: string, fn: (s: ResumeSection) => ResumeSection) =>
    update((d) => {
      d.sections = d.sections.map((s) => (s.id === sectionId ? fn(s) : s))
    })

  /** Every AI change can be undone in one click. */
  const applyAi = (next: ResumeData) => {
    setUndoStack((stack) => [...stack.slice(-9), data])
    // The AI only works on content; the look stays what the user picked.
    setData({ ...next, template: data.template })
  }

  const undo = () => {
    const previous = undoStack[undoStack.length - 1]
    if (!previous) return
    setUndoStack((stack) => stack.slice(0, -1))
    setData(previous)
    setTailorNotes(null)
  }

  const runAi = async (key: string, task: () => Promise<void>) => {
    setBusy(key)
    setAiError(null)
    try {
      await task()
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  const importFile = (file: File) =>
    runAi("import", async () => {
      const { text } = await readDocument(file)
      const imported = await aiImport(text, file)
      if (isBlank(imported) && !imported.name) throw new Error("We couldn't find resume details in that file.")
      applyAi(imported)
      if (!title.trim() || title === "Untitled resume") setTitle(imported.name ? `${imported.name} resume` : file.name)
      setTailorNotes(null)
    })

  const tailor = () =>
    runAi("tailor", async () => {
      const result = await aiTailor(data, jobDescription, tailorInstructions)
      applyAi(result.resume)
      setTailorNotes({ changes: result.changes, missingSkills: result.missingSkills })
      setTailored(true)
      try {
        window.localStorage.setItem(tailoredKey, "1")
      } catch {
        // Storage blocked — "Ask AI to edit" shows again after the next tailoring.
      }
    })

  const askAi = () =>
    runAi("edit", async () => {
      const result = await aiEdit(data, editRequest.trim(), jobDescription)
      applyAi(result.resume)
      setTailorNotes({ changes: result.changes, missingSkills: [] })
      setEditRequest("")
    })

  /** A click on a line of the preview opens the line editor on it. */
  const onPreviewClick = (e: MouseEvent) => {
    // A link in the preview edits its line like any other text; it only
    // opens from the downloaded PDF.
    if ((e.target as HTMLElement).closest("a")) e.preventDefault()
    if (showSample) return
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-edit]")
    const target = el && readEditTarget(el)
    if (!el || !target) return
    setLineEdit({ target, anchor: el.getBoundingClientRect() })
  }

  const improve = (sectionId: string, entry: ResumeEntry) =>
    runAi(`improve:${entry.id}`, async () => {
      const items = await aiImprove({ ...entry, items: entry.items.filter((i) => i.trim()) }, jobDescription)
      if (items.length === 0) throw new Error("The AI didn't return anything. Please try again.")
      applyAi(
        (() => {
          const draft = structuredClone(data)
          const section = draft.sections.find((s) => s.id === sectionId)
          const target = section?.kind === "entries" ? section.entries.find((e) => e.id === entry.id) : undefined
          if (target) target.items = items
          return draft
        })(),
      )
    })

  const downloadPdf = async () => {
    // The preview shows sample content then, which must never end up in the PDF.
    if (isBlank(data)) {
      window.alert("Add your details first. The preview is only showing sample content.")
      return
    }
    if (status !== "saved") await save()
    const previous = document.title
    // Chrome and Edge use the page title as the PDF's file name.
    document.title = `${(data.name || title).trim() || "Resume"} - Resume`
    window.print()
    document.title = previous
  }

  const addSection = (kind: SectionKind) => {
    const titles: Record<SectionKind, string> = { text: "Summary", entries: "Projects", table: "Skills" }
    update((d) => {
      d.sections.push(emptySection(kind, titles[kind]))
    })
  }

  // An empty resume would show only a name, so preview the sample in the
  // chosen template until the user types something of their own.
  const showSample = isBlank(data)
  const previewData = showSample ? sampleResume(data.template) : data
  const tips = showSample ? [] : resumeTips(data)

  const statusText: Record<SaveStatus, string> = {
    saved: "Saved",
    pending: "Editing…",
    saving: "Saving…",
    failed: "Couldn't save — retrying on next change",
  }

  return (
    <div className={`${theme === "dark" ? "dark" : ""} rb-root flex h-dvh flex-col bg-background text-foreground`}>
      <header className="rb-chrome flex items-center gap-2 border-b border-border px-3 py-2.5 sm:gap-3 sm:px-4">
        <Link href="/dashboard?view=resumes" className={iconButton} aria-label="Back to my resumes">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Resume name"
          className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold text-foreground hover:bg-foreground/5 focus:bg-foreground/5 focus:outline-none sm:max-w-xs"
        />
        <span className={`hidden text-xs sm:inline ${status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
          {statusText[status]}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {undoStack.length > 0 && (
            <button
              type="button"
              onClick={undo}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/10"
            >
              <Undo2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Undo AI change</span>
            </button>
          )}
          <button
            type="button"
            onClick={downloadPdf}
            className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
          >
            <Download className="h-3.5 w-3.5" />
            PDF
          </button>
        </div>
      </header>

      <div className="rb-chrome flex border-b border-border lg:hidden">
        {(["edit", "preview"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setMobileTab(tab)}
            className={`flex-1 border-b-2 py-2.5 text-sm font-medium capitalize transition-colors ${
              mobileTab === tab ? "border-foreground text-foreground" : "border-transparent text-muted-foreground"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className={`rb-chrome w-full shrink-0 overflow-y-auto border-r border-border lg:block lg:w-[460px] xl:w-[520px] ${
            mobileTab === "edit" ? "block" : "hidden"
          }`}
        >
          <div className="flex flex-col gap-5 p-4 sm:p-5">
            {/* AI tools */}
            <div className="flex flex-col gap-3 rounded-xl border border-blue-500/25 bg-blue-500/[0.05] p-4 dark:border-blue-400/25">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                AI tools
              </div>
              <input
                ref={fileInput}
                type="file"
                accept={DOCUMENT_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ""
                  if (file) importFile(file)
                }}
              />
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => fileInput.current?.click()}
                className="flex items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-50"
              >
                {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                {busy === "import" ? "Reading your resume…" : "Import my old resume (PDF / DOCX)"}
              </button>

              <label className="flex flex-col gap-1 border-t border-border pt-3">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Target className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  Tailor to a job
                </span>
                <span className="text-xs text-muted-foreground">Job description</span>
                <textarea
                  className={`${inputClass} min-h-20 resize-y`}
                  value={jobDescription}
                  placeholder="Paste the job description here"
                  onChange={(e) => setJobDescription(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Custom instructions to AI (optional)</span>
                <textarea
                  className={`${inputClass} min-h-16 resize-y`}
                  value={tailorInstructions}
                  maxLength={1000}
                  placeholder="e.g. Focus on my AWS work"
                  onChange={(e) => setTailorInstructions(e.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={busy !== null || !jobDescription.trim()}
                onClick={tailor}
                className="flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy === "tailor" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
                {busy === "tailor" ? "Tailoring…" : "Tailor to this job"}
              </button>
              <p className="text-xs text-muted-foreground">
                AI only rewords and reorders what you really did. It never adds jobs, skills or numbers you don&apos;t have.
              </p>

              {/* Fine edits come after the resume is in and tailored to the job. */}
              {tailored && (
                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <Wand2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                    Ask AI to edit
                  </span>
                  <textarea
                    className={`${inputClass} min-h-16 resize-y`}
                    value={editRequest}
                    placeholder="Tell AI what to change, e.g. Rewrite my summary for a data analyst role"
                    onChange={(e) => setEditRequest(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && editRequest.trim() && busy === null) askAi()
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy !== null || !editRequest.trim() || showSample}
                    onClick={askAi}
                    className="flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {busy === "edit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {busy === "edit" ? "Making the change…" : "Apply with AI"}
                  </button>
                </div>
              )}

              {aiError && (
                <div className="flex items-start justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <span>{aiError}</span>
                  <button type="button" onClick={() => setAiError(null)} aria-label="Dismiss">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {tailorNotes && (
                <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">What changed</span>
                    <button type="button" onClick={() => setTailorNotes(null)} aria-label="Close" className="text-muted-foreground">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {tailorNotes.changes.length > 0 && (
                    <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                      {tailorNotes.changes.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  )}
                  {tailorNotes.missingSkills.length > 0 && (
                    <>
                      <span className="mt-1 font-semibold text-foreground">The job asks for, but your resume doesn&apos;t mention:</span>
                      <div className="flex flex-wrap gap-1.5">
                        {tailorNotes.missingSkills.map((s) => (
                          <span key={s} className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-800 dark:text-amber-300">
                            {s}
                          </span>
                        ))}
                      </div>
                      <span className="text-muted-foreground">Add these yourself only if you really have them.</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Resume check */}
            {!showSample && (
              <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <ClipboardCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  Resume check
                </div>
                {tips.length === 0 ? (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Looks good. Nothing obvious to fix.
                  </p>
                ) : (
                  <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                    {tips.map((tip) => (
                      <li key={tip}>{tip}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Template */}
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
              <div className="text-sm font-semibold text-foreground">Template</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => update((d) => void (d.template = t.id))}
                    className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors ${
                      data.template === t.id
                        ? "border-blue-600 bg-blue-500/[0.07] ring-1 ring-blue-600 dark:border-blue-400 dark:ring-blue-400"
                        : "border-border hover:bg-foreground/5"
                    }`}
                  >
                    <span
                      className={`text-sm font-semibold ${TEMPLATE_LABEL_CLASS[t.id]}`}
                      style={{ fontFamily: TEMPLATE_FONT[t.id] }}
                    >
                      {t.name}
                    </span>
                    <span className="text-xs text-muted-foreground">{t.description}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Your content stays the same when you switch. In any line, <code>**text**</code> makes words bold and a line
                starting with <code>- </code> becomes a sub-point. In Modern Blue, first lines like{" "}
                <code>**Client:** Acme</code> show as a two-column detail block.
              </p>
            </div>

            {/* Header */}
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
              <div className="text-sm font-semibold text-foreground">Name and contact</div>
              <Field label="Full name" value={data.name} onChange={(v) => update((d) => void (d.name = v))} />
              <Field
                label="Headline (optional)"
                value={data.tagline}
                placeholder="Software Engineer • Technical Lead"
                onChange={(v) => update((d) => void (d.tagline = v))}
              />
              {data.contact.map((item, index) => (
                <div key={item.id} className="flex items-end gap-2">
                  <div className="w-28 shrink-0">
                    <Field
                      label="Label"
                      value={item.label}
                      onChange={(v) => update((d) => void (d.contact[index].label = v))}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Field label="Value" value={item.value} onChange={(v) => update((d) => void (d.contact[index].value = v))} />
                  </div>
                  <button
                    type="button"
                    className={`${iconButton} mb-0.5`}
                    onClick={() => update((d) => void d.contact.splice(index, 1))}
                    aria-label="Remove contact line"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => update((d) => void d.contact.push({ id: newId(), label: "", value: "" }))}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" /> Add contact line
                </button>
                <button
                  type="button"
                  onClick={() => update((d) => void d.contact.push({ id: newId(), label: "Portfolio", value: "https://" }))}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                >
                  <Link2 className="h-3.5 w-3.5" /> Add link
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Email, phone and web addresses (like linkedin.com/in/you or github.com/you) are clickable in your PDF.
              </p>
            </div>

            {/* Sections */}
            {data.sections.map((section, index) => (
              <div key={section.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-1">
                  <input
                    value={section.title}
                    onChange={(e) => updateSection(section.id, (s) => ({ ...s, title: e.target.value }))}
                    aria-label="Section title"
                    className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-sm font-semibold text-foreground hover:bg-foreground/5 focus:bg-foreground/5 focus:outline-none"
                  />
                  <span className="mr-1 hidden text-xs text-muted-foreground sm:inline">{KIND_LABEL[section.kind]}</span>
                  <button
                    type="button"
                    className={iconButton}
                    disabled={index === 0}
                    onClick={() => update((d) => void (d.sections = move(d.sections, index, -1)))}
                    aria-label="Move section up"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className={iconButton}
                    disabled={index === data.sections.length - 1}
                    onClick={() => update((d) => void (d.sections = move(d.sections, index, 1)))}
                    aria-label="Move section down"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className={iconButton}
                    onClick={() => {
                      if (window.confirm(`Delete the "${section.title || "untitled"}" section?`)) {
                        update((d) => void d.sections.splice(index, 1))
                      }
                    }}
                    aria-label="Delete section"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {section.kind === "text" && (
                  <textarea
                    className={`${inputClass} min-h-24 resize-y leading-relaxed`}
                    value={section.text}
                    placeholder="2–3 sentences about who you are and what you're good at"
                    onChange={(e) => updateSection(section.id, (s) => ({ ...s, text: e.target.value }))}
                  />
                )}

                {section.kind === "table" && (
                  <>
                    {section.rows.map((row, rowIndex) => (
                      <div key={row.id} className="flex items-start gap-2">
                        <input
                          className={`${inputClass} w-36 shrink-0 font-medium`}
                          value={row.label}
                          placeholder="Languages"
                          onChange={(e) =>
                            updateSection(section.id, (s) =>
                              s.kind === "table"
                                ? { ...s, rows: s.rows.map((r) => (r.id === row.id ? { ...r, label: e.target.value } : r)) }
                                : s,
                            )
                          }
                        />
                        <input
                          className={`${inputClass} min-w-0 flex-1`}
                          value={row.value}
                          placeholder="Python, SQL, React"
                          onChange={(e) =>
                            updateSection(section.id, (s) =>
                              s.kind === "table"
                                ? { ...s, rows: s.rows.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)) }
                                : s,
                            )
                          }
                        />
                        <button
                          type="button"
                          className={iconButton}
                          onClick={() =>
                            updateSection(section.id, (s) =>
                              s.kind === "table" ? { ...s, rows: s.rows.filter((_, i) => i !== rowIndex) } : s,
                            )
                          }
                          aria-label="Remove row"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        updateSection(section.id, (s) =>
                          s.kind === "table" ? { ...s, rows: [...s.rows, { id: newId(), label: "", value: "" }] } : s,
                        )
                      }
                      className="flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add row
                    </button>
                  </>
                )}

                {section.kind === "entries" && (
                  <>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      Show lines as
                      <select
                        value={section.listStyle}
                        onChange={(e) =>
                          updateSection(section.id, (s) =>
                            s.kind === "entries" ? { ...s, listStyle: e.target.value as ListStyle } : s,
                          )
                        }
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                      >
                        <option value="bullets">Bullet points</option>
                        <option value="italic">Italic lines</option>
                        <option value="plain">Plain text</option>
                      </select>
                    </label>
                    {section.entries.map((entry, entryIndex) => (
                      <EntryEditor
                        key={entry.id}
                        entry={entry}
                        listStyle={section.listStyle}
                        canUp={entryIndex > 0}
                        canDown={entryIndex < section.entries.length - 1}
                        improving={busy === `improve:${entry.id}`}
                        onChange={(next) =>
                          updateSection(section.id, (s) =>
                            s.kind === "entries" ? { ...s, entries: s.entries.map((e) => (e.id === entry.id ? next : e)) } : s,
                          )
                        }
                        onMove={(by) =>
                          updateSection(section.id, (s) =>
                            s.kind === "entries" ? { ...s, entries: move(s.entries, entryIndex, by) } : s,
                          )
                        }
                        onRemove={() =>
                          updateSection(section.id, (s) =>
                            s.kind === "entries" ? { ...s, entries: s.entries.filter((e) => e.id !== entry.id) } : s,
                          )
                        }
                        onImprove={() => improve(section.id, entry)}
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        updateSection(section.id, (s) =>
                          s.kind === "entries" ? { ...s, entries: [...s.entries, emptyEntry()] } : s,
                        )
                      }
                      className="flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add entry
                    </button>
                  </>
                )}
              </div>
            ))}

            <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-4">
              <div className="text-xs font-medium text-muted-foreground">Add a section</div>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["entries", "Entries (jobs, projects)"],
                    ["table", "Two columns (skills)"],
                    ["text", "Paragraph (summary)"],
                  ] as const
                ).map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => addSection(kind)}
                    className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/10"
                  >
                    <Plus className="h-3.5 w-3.5" /> {label}
                  </button>
                ))}
              </div>
            </div>

            <p className="pb-4 text-center text-xs text-muted-foreground">
              Tip: in the PDF dialog, choose &quot;Save as PDF&quot; and turn off &quot;Headers and footers&quot;.
            </p>
          </div>
        </div>

        <div
          className={`rb-print-area min-w-0 flex-1 overflow-y-auto bg-neutral-200 p-3 sm:p-6 lg:block dark:bg-neutral-900 ${
            mobileTab === "preview" ? "block" : "hidden"
          }`}
          // The line editor is placed by where the line was; once the page moves, close it.
          onScroll={() => setLineEdit(null)}
        >
          <div ref={previewRef} className="mx-auto w-full max-w-[794px]">
            <p className="rb-chrome mb-3 text-center text-xs text-muted-foreground">
              {showSample
                ? "Sample content, to show how this template looks. Fill in the form or import your old resume to replace it."
                : "Tip: click any line on the resume to edit it."}
            </p>
            <div
              className={`rb-scale w-fit shadow-xl ${showSample ? "" : "rb-editable"}`}
              style={{ zoom: scale }}
              onClick={onPreviewClick}
            >
              <ResumePreview data={previewData} />
            </div>
          </div>
        </div>
      </div>

      {lineEdit && (
        <LineEditor
          key={JSON.stringify(lineEdit.target)}
          target={lineEdit.target}
          anchor={lineEdit.anchor}
          data={data}
          jobDescription={jobDescription}
          onSave={update}
          onClose={() => setLineEdit(null)}
        />
      )}
    </div>
  )
}
