"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Loader2, Sparkles, Trash2, X } from "lucide-react"
import { aiRewrite } from "@/lib/resume/api"
import type { EditTarget } from "@/lib/resume/edit-target"
import type { ResumeData, ResumeEntry, ResumeSection } from "@/lib/resume/types"

// The small box that opens over a line the user clicked in the preview: the
// line's own fields to edit by hand, and for longer text an AI rewrite with an
// optional "how" — the result lands in the box to check before saving.

type Field = { key: string; label: string; multiline?: boolean }

interface Spec {
  title: string
  fields: Field[]
  values: Record<string, string>
  /** Which field the AI rewrites, if any. */
  aiField?: string
  /** Where the text sits, for the AI. */
  context: string
  canDelete: boolean
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/30"

function findSection(data: ResumeData, id: string): ResumeSection | undefined {
  return data.sections.find((s) => s.id === id)
}

function findEntry(data: ResumeData, sectionId: string, id: string): ResumeEntry | undefined {
  const section = findSection(data, sectionId)
  return section?.kind === "entries" ? section.entries.find((e) => e.id === id) : undefined
}

function specFor(target: EditTarget, data: ResumeData): Spec | null {
  switch (target.kind) {
    case "name":
      return { title: "Name", fields: [{ key: "value", label: "Full name" }], values: { value: data.name }, context: "", canDelete: false }
    case "tagline":
      return {
        title: "Headline",
        fields: [{ key: "value", label: "Headline" }],
        values: { value: data.tagline },
        aiField: "value",
        context: "Headline under the name",
        canDelete: true,
      }
    case "contact": {
      const item = data.contact.find((c) => c.id === target.id)
      if (!item) return null
      return {
        title: "Contact",
        fields: [
          { key: "label", label: "Label" },
          { key: "value", label: "Value" },
        ],
        values: { label: item.label, value: item.value },
        context: "",
        canDelete: true,
      }
    }
    case "title": {
      const section = findSection(data, target.sectionId)
      if (!section) return null
      return { title: "Section title", fields: [{ key: "value", label: "Title" }], values: { value: section.title }, context: "", canDelete: false }
    }
    case "text": {
      const section = findSection(data, target.sectionId)
      if (section?.kind !== "text") return null
      return {
        title: section.title || "Paragraph",
        fields: [{ key: "value", label: "Text", multiline: true }],
        values: { value: section.text },
        aiField: "value",
        context: section.title,
        canDelete: false,
      }
    }
    case "row": {
      const section = findSection(data, target.sectionId)
      const row = section?.kind === "table" ? section.rows.find((r) => r.id === target.id) : undefined
      if (!section || !row) return null
      return {
        title: section.title || "Row",
        fields: [
          { key: "label", label: "Label" },
          { key: "value", label: "Value", multiline: true },
        ],
        values: { label: row.label, value: row.value },
        aiField: "value",
        context: `${section.title} > ${row.label}`,
        canDelete: true,
      }
    }
    case "head": {
      const entry = findEntry(data, target.sectionId, target.id)
      if (!entry) return null
      return {
        title: "Entry heading",
        fields: [
          { key: "heading", label: "Heading" },
          { key: "headingRight", label: "Right side" },
          { key: "subheading", label: "Sub-heading" },
          { key: "subheadingRight", label: "Right side" },
        ],
        values: {
          heading: entry.heading,
          headingRight: entry.headingRight,
          subheading: entry.subheading,
          subheadingRight: entry.subheadingRight,
        },
        context: "",
        canDelete: false,
      }
    }
    case "item": {
      const section = findSection(data, target.sectionId)
      const entry = findEntry(data, target.sectionId, target.id)
      if (!section || !entry || target.index >= entry.items.length) return null
      return {
        title: "Line",
        fields: [{ key: "value", label: "Text", multiline: true }],
        values: { value: entry.items[target.index] },
        aiField: "value",
        context: [section.title, entry.heading, entry.subheading].filter(Boolean).join(" > "),
        canDelete: true,
      }
    }
  }
}

/** Writes the edited values (or removes the line) into a draft of the resume. */
function applyTo(draft: ResumeData, target: EditTarget, values: Record<string, string> | null) {
  switch (target.kind) {
    case "name":
      draft.name = values?.value ?? draft.name
      return
    case "tagline":
      draft.tagline = values?.value ?? ""
      return
    case "contact": {
      const i = draft.contact.findIndex((c) => c.id === target.id)
      if (i < 0) return
      if (values) draft.contact[i] = { ...draft.contact[i], label: values.label, value: values.value }
      else draft.contact.splice(i, 1)
      return
    }
    case "title": {
      const section = findSection(draft, target.sectionId)
      if (section && values) section.title = values.value
      return
    }
    case "text": {
      const section = findSection(draft, target.sectionId)
      if (section?.kind === "text" && values) section.text = values.value
      return
    }
    case "row": {
      const section = findSection(draft, target.sectionId)
      if (section?.kind !== "table") return
      const i = section.rows.findIndex((r) => r.id === target.id)
      if (i < 0) return
      if (values) section.rows[i] = { ...section.rows[i], label: values.label, value: values.value }
      else section.rows.splice(i, 1)
      return
    }
    case "head": {
      const entry = findEntry(draft, target.sectionId, target.id)
      if (entry && values) Object.assign(entry, values)
      return
    }
    case "item": {
      const entry = findEntry(draft, target.sectionId, target.id)
      if (!entry) return
      if (values) entry.items[target.index] = values.value
      else entry.items.splice(target.index, 1)
      return
    }
  }
}

const WIDTH = 380

export function LineEditor({
  target,
  anchor,
  data,
  jobDescription,
  onSave,
  onClose,
}: {
  target: EditTarget
  /** The clicked line's box on screen. */
  anchor: DOMRect
  data: ResumeData
  jobDescription: string
  onSave: (fn: (draft: ResumeData) => void) => void
  onClose: () => void
}) {
  const [spec] = useState(() => specFor(target, data))
  const [values, setValues] = useState(spec?.values ?? {})
  const [how, setHow] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const firstField = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  // Below the line, or above it when there isn't room; always on screen.
  useLayoutEffect(() => {
    const height = boxRef.current?.offsetHeight ?? 300
    const width = Math.min(WIDTH, window.innerWidth - 24)
    const below = anchor.bottom + 8
    const top = below + height <= window.innerHeight - 12 ? below : Math.max(12, anchor.top - height - 8)
    const left = Math.min(Math.max(12, anchor.left), window.innerWidth - width - 12)
    setPosition({ top, left })
    firstField.current?.focus()
  }, [anchor])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  if (!spec) return null

  const save = () => {
    onSave((draft) => applyTo(draft, target, values))
    onClose()
  }

  const remove = () => {
    onSave((draft) => applyTo(draft, target, null))
    onClose()
  }

  const rewrite = async () => {
    if (!spec.aiField) return
    setBusy(true)
    setError(null)
    try {
      const text = await aiRewrite(values[spec.aiField], how, spec.context, jobDescription)
      setValues((v) => ({ ...v, [spec.aiField!]: text }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onMouseDown={onClose} />
      <div
        ref={boxRef}
        role="dialog"
        aria-label={`Edit ${spec.title}`}
        className="fixed z-50 flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3 text-foreground shadow-2xl"
        style={{
          width: `min(${WIDTH}px, calc(100vw - 24px))`,
          top: position?.top ?? anchor.bottom + 8,
          left: position?.left ?? 12,
          visibility: position ? "visible" : "hidden",
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save()
        }}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">{spec.title}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className={spec.fields.length === 4 ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2"}>
          {spec.fields.map((field, i) => (
            <label key={field.key} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">{field.label}</span>
              {field.multiline ? (
                <textarea
                  ref={i === 0 ? firstField : undefined}
                  className={`${inputClass} min-h-20 resize-y leading-relaxed`}
                  value={values[field.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                />
              ) : (
                <input
                  ref={i === 0 ? firstField : undefined}
                  className={inputClass}
                  value={values[field.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && save()}
                />
              )}
            </label>
          ))}
        </div>

        {spec.aiField && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-blue-500/25 bg-blue-500/[0.05] p-2">
            <input
              className={`${inputClass} text-xs`}
              value={how}
              placeholder="How to change it (optional), e.g. shorter, add impact"
              onChange={(e) => setHow(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && values[spec.aiField!].trim() && rewrite()}
            />
            <button
              type="button"
              onClick={rewrite}
              disabled={busy || !values[spec.aiField].trim()}
              className="flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {busy ? "Rewriting…" : "Rewrite with AI"}
            </button>
            {error && <span className="text-xs text-destructive">{error}</span>}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          {spec.canDelete ? (
            <button
              type="button"
              onClick={remove}
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-foreground/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
