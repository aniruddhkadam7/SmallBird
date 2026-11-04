// The resume builder's data: one JSON object per resume, stored as-is in
// public.resumes.data (backend migration 0050) and rendered by
// components/resume/resume-preview.tsx in the navy "institutional" layout.
// The resume-ai Edge Function describes this same shape to the model, so a
// change here needs the SHAPE text there updated too.

export interface ContactItem {
  id: string
  label: string
  value: string
}

/** One block under a section: e.g. a job (company / dates / title / place) or a degree. */
export interface ResumeEntry {
  id: string
  heading: string
  headingRight: string
  subheading: string
  subheadingRight: string
  items: string[]
}

export interface TableRow {
  id: string
  label: string
  value: string
}

/** bullets: work/projects. italic: education details, no bullet. plain: a short paragraph. */
export type ListStyle = "bullets" | "italic" | "plain"

export type ResumeSection =
  | { id: string; title: string; kind: "text"; text: string }
  | { id: string; title: string; kind: "entries"; listStyle: ListStyle; entries: ResumeEntry[] }
  | { id: string; title: string; kind: "table"; rows: TableRow[] }

export type SectionKind = ResumeSection["kind"]

/** How the same content looks: formal serif, one-page tech, or blue with spaced capitals. */
export type TemplateId = "navy" | "classic" | "modern" | "sidebar" | "bold"

export const TEMPLATES: { id: TemplateId; name: string; description: string }[] = [
  { id: "navy", name: "Navy Formal", description: "Serif, navy headings. Good for research and formal roles." },
  { id: "classic", name: "Classic Tech", description: "Clean sans-serif. The usual one-page software resume." },
  { id: "modern", name: "Modern Blue", description: "Spaced capitals and blue accents. Good for senior and lead roles." },
  { id: "sidebar", name: "Grey Sidebar", description: "Two columns: contact and skills on the left, a timeline on the right." },
  { id: "bold", name: "Bold Header", description: "Dark header band, coloured labels and a timeline. Stands out." },
]

/** Templates with a side column: short sections (text, tables) go there, entries go in the main column. */
export function hasSidebar(template: TemplateId): boolean {
  return template === "sidebar" || template === "bold"
}

export interface ResumeData {
  template: TemplateId
  name: string
  /** Optional line under the name, e.g. "Software Engineer • Technical Lead". */
  tagline: string
  contact: ContactItem[]
  sections: ResumeSection[]
}

export interface ResumeRow {
  id: string
  title: string
  data: ResumeData
  created_at: string
  updated_at: string
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function emptyEntry(): ResumeEntry {
  return { id: newId(), heading: "", headingRight: "", subheading: "", subheadingRight: "", items: [] }
}

export function emptySection(kind: SectionKind, title: string): ResumeSection {
  if (kind === "text") return { id: newId(), title, kind, text: "" }
  if (kind === "table") return { id: newId(), title, kind, rows: [{ id: newId(), label: "", value: "" }] }
  return { id: newId(), title, kind, listStyle: "bullets", entries: [emptyEntry()] }
}

/** What "New resume" starts from: the usual sections, empty, so the form shows every field. */
export function starterResume(name: string, email: string): ResumeData {
  const education = emptySection("entries", "Education")
  if (education.kind === "entries") education.listStyle = "italic"
  return {
    template: "navy",
    name,
    tagline: "",
    contact: [
      { id: newId(), label: "E-mail", value: email },
      { id: newId(), label: "Phone", value: "" },
      { id: newId(), label: "Location", value: "" },
      { id: newId(), label: "LinkedIn", value: "" },
    ],
    sections: [
      emptySection("text", "Summary"),
      emptySection("entries", "Work experience"),
      education,
      emptySection("table", "Technical skills"),
    ],
  }
}

const str = (v: unknown, max = 2000): string => (typeof v === "string" ? v.trim().slice(0, max) : "")

function list<T>(v: unknown, map: (item: unknown) => T | null, max = 60): T[] {
  if (!Array.isArray(v)) return []
  return v
    .slice(0, max)
    .map(map)
    .filter((x): x is T => x !== null)
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * Turns anything (an AI reply, an old saved row) into a valid ResumeData,
 * keeping ids that are already there and making new ones where missing.
 */
export function normalizeResume(input: unknown): ResumeData {
  const r = obj(input) ?? {}
  const contact = list(r.contact, (c) => {
    const o = obj(c)
    if (!o || (!str(o.label) && !str(o.value))) return null
    return { id: str(o.id) || newId(), label: str(o.label, 60), value: str(o.value, 300) }
  }, 12)

  const sections = list(r.sections, (s): ResumeSection | null => {
    const o = obj(s)
    if (!o) return null
    const id = str(o.id) || newId()
    const title = str(o.title, 80)
    if (o.kind === "text") return { id, title, kind: "text", text: str(o.text, 3000) }
    if (o.kind === "table") {
      const rows = list(o.rows, (row) => {
        const ro = obj(row)
        if (!ro || (!str(ro.label) && !str(ro.value))) return null
        return { id: str(ro.id) || newId(), label: str(ro.label, 120), value: str(ro.value, 600) }
      })
      return { id, title, kind: "table", rows }
    }
    const listStyle: ListStyle = o.listStyle === "italic" || o.listStyle === "plain" ? o.listStyle : "bullets"
    const entries = list(o.entries, (e) => {
      const eo = obj(e)
      if (!eo) return null
      return {
        id: str(eo.id) || newId(),
        heading: str(eo.heading, 200),
        headingRight: str(eo.headingRight, 120),
        subheading: str(eo.subheading, 200),
        subheadingRight: str(eo.subheadingRight, 120),
        items: list(eo.items, (it) => str(it, 600) || null, 20),
      }
    })
    return { id, title, kind: "entries", listStyle, entries }
  }, 20)

  const template = TEMPLATES.find((t) => t.id === r.template)?.id ?? "navy"
  return { template, name: str(r.name, 120), tagline: str(r.tagline, 160), contact, sections }
}

/** True when a resume has nothing typed into it yet (so importing over it loses nothing). */
export function isBlank(data: ResumeData): boolean {
  return data.sections.every((s) =>
    s.kind === "text"
      ? !s.text
      : s.kind === "table"
        ? s.rows.every((r) => !r.label && !r.value)
        : s.entries.every((e) => !e.heading && !e.subheading && e.items.length === 0),
  )
}
