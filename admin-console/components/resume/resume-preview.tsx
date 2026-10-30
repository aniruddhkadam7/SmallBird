// Copied from SmallBird-website (same path there) so the admin console draws
// resumes exactly as the user sees and prints them. Keep in step with it.

import type { ReactNode } from "react"
import { editAttrs } from "@/lib/resume/edit-target"
import {
  hasSidebar,
  type ContactItem,
  type ListStyle,
  type ResumeData,
  type ResumeEntry,
  type ResumeSection,
  type TemplateId,
} from "@/lib/resume/types"

// Draws one resume in its chosen template; styles are in app/resume/resume.css
// and the same markup is what gets printed to PDF.
//  - navy: after Christian Maria Giannetti's LaTeX template — centred italic
//    name, "Label: value" contact lines two to a row, italic navy titles.
//  - classic: after Audric Serador's (sb2nov-style) LaTeX template — big
//    centred name, one contact row with icons, plain titles over a black rule,
//    "Project | tech stack" lines and "Label: value" skill lines.
//  - modern: after Harikrishnan Kurup's cvhari template — spaced capitals,
//    blue accents, company/title then place/dates with icons, a two-column
//    "Project: / Client:" detail block and dashed lines between jobs.
//  - sidebar: after the Twenty Seconds CV — grey left column with name,
//    contact and short sections, grey title bands and a date column right.
//  - bold: after the simplehipstercv mashup — dark name band, grey sidebar
//    with coloured labels, a "date | entry" timeline on the right.
// In the two-column ones, text and table sections go in the side column and
// entry sections in the main one, whatever order they are in.
//
// The flowing content is cut into blocks (a section title, a paragraph, a
// skills table, an entry's heading, one bullet line) so a paged preview can
// split a resume into A4 pages between any two blocks. Every block's outer
// element carries data-b=<its index> for that measuring.
//
// Every line the user can click to edit carries editAttrs (lib/resume/edit-target.ts).
//
// Shared conventions in any line: `**text**` is bold, and a line starting
// with "- " is a dash sub-point under the bullet before it.

function rich(text: string): ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  if (parts.length === 1) return text
  return parts.map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part))
}

const ICON_PATHS: Record<string, string> = {
  phone:
    "M6.6 10.8a15.2 15.2 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z",
  mail: "M2 5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zm2.4 0L12 10.5 19.6 5zM4 7.2V19h16V7.2l-8 5.8z",
  linkedin:
    "M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z",
  github:
    "M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.1 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.1.9 2.2v3.3c0 .3.1.7.8.6A12 12 0 0 0 12 .3",
  location:
    "M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z",
  calendar:
    "M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3zm12 8H5v9h14zM5 6v2h14V6z",
  link: "M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12zM8 13h8v-2H8zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10z",
}

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="rv-icon">
      <path d={ICON_PATHS[name]} />
    </svg>
  )
}

function iconFor(item: ContactItem): string {
  const s = `${item.label} ${item.value}`.toLowerCase()
  if (s.includes("linkedin")) return "linkedin"
  if (s.includes("github")) return "github"
  if (s.includes("@") || /mail/.test(s)) return "mail"
  if (/phone|mobile|tel/.test(s) || /^\+?[\d\s()-]{7,}$/.test(item.value)) return "phone"
  if (/location|address|city|residence/.test(s)) return "location"
  return "link"
}

function looksLikeLink(item: ContactItem): boolean {
  return /@|linkedin|github|https?:|www\.|\.(com|in|io|dev|me|org)\b/i.test(item.value)
}

/** Dates get a calendar, anything else (a place) a pin — the fields are used both ways. */
function isDate(text: string): boolean {
  return /\b(19|20)\d{2}\b|\b20xx\b|present|till now|current/i.test(text)
}

function Contact({ contact, template }: { contact: ContactItem[]; template: TemplateId }) {
  if (contact.length === 0) return null

  if (template !== "navy") {
    return (
      <div className="rv-contact">
        {contact.map((item) => (
          <span key={item.id} className="rv-contact-item" {...editAttrs({ kind: "contact", id: item.id })}>
            <Icon name={iconFor(item)} />
            <span className={template === "classic" && looksLikeLink(item) ? "rv-link" : undefined}>{item.value}</span>
          </span>
        ))}
      </div>
    )
  }

  const rows: ContactItem[][] = []
  for (let i = 0; i < contact.length; i += 2) rows.push(contact.slice(i, i + 2))
  return (
    <div className="rv-contact">
      {rows.map((row, i) => (
        <div key={i}>
          {row.map((item, j) => (
            <span key={item.id} {...editAttrs({ kind: "contact", id: item.id })}>
              {j > 0 && <span className="rv-sep"> ✻ </span>}
              {item.label && <em className="rv-tag">{item.label}: </em>}
              {item.value}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

const DETAIL = /^\*\*([^*]+?):?\*\*:?\s*(.*)$/

/** A line of entry.items with its position there (blanks included), so a click can find it again. */
type Line = { text: string; index: number }
type Detail = { label: string; value: string; index: number }

/** The leading "**Label:** value" lines of an entry (Project:, Client:, Responsibilities: ...). */
function splitDetails(items: Line[]): { details: Detail[]; rest: Line[] } {
  const details: Detail[] = []
  let i = 0
  for (; i < items.length; i++) {
    const m = DETAIL.exec(items[i].text)
    if (!m) break
    details.push({ label: m[1], value: m[2], index: items[i].index })
  }
  return { details, rest: items.slice(i) }
}

/** An entry's detail lines and the remaining items, as drawn. */
function entryParts(entry: ResumeEntry) {
  const all = entry.items.map((text, index) => ({ text, index })).filter((line) => line.text)
  const split = splitDetails(all)
  // A single bold lead-in ("**Relevant Coursework:** ...") stays a normal line;
  // two or more make a detail block (a grid in modern, one line elsewhere).
  return split.details.length >= 2 ? split : { details: [] as Detail[], rest: all }
}

function visibleEntries(entries: ResumeEntry[]): ResumeEntry[] {
  return entries.filter((e) => e.heading || e.subheading || e.items.some(Boolean))
}

/** The right-side fields hold a date and a place in either order; find which is which. */
function dateAndPlace(entry: ResumeEntry): { date: string; place: string } {
  const [a, b] = [entry.headingRight, entry.subheadingRight]
  if (a && isDate(a)) return { date: a, place: b }
  if (b && isDate(b)) return { date: b, place: a }
  return { date: "", place: [a, b].filter(Boolean).join(" · ") }
}

// ---- Blocks ----------------------------------------------------------------

type EntriesSection = Extract<ResumeSection, { kind: "entries" }>

export type Block =
  | { kind: "title"; section: ResumeSection }
  | { kind: "text"; section: Extract<ResumeSection, { kind: "text" }> }
  | { kind: "table"; section: Extract<ResumeSection, { kind: "table" }> }
  /** An entry's heading lines plus its detail lines. */
  | { kind: "head"; section: EntriesSection; entry: ResumeEntry }
  /** One bullet / line of an entry. */
  | { kind: "item"; section: EntriesSection; entry: ResumeEntry; line: Line }

/** The blocks that flow down the page (the main column, in two-column templates). */
export function flowBlocks(data: ResumeData): Block[] {
  const twoCol = hasSidebar(data.template)
  const blocks: Block[] = []
  for (const section of data.sections) {
    if (section.kind === "text") {
      if (twoCol || !section.text) continue
      blocks.push({ kind: "title", section }, { kind: "text", section })
    } else if (section.kind === "table") {
      if (twoCol || section.rows.every((r) => !r.label && !r.value)) continue
      blocks.push({ kind: "title", section }, { kind: "table", section })
    } else {
      const entries = visibleEntries(section.entries)
      if (entries.length === 0) continue
      blocks.push({ kind: "title", section })
      for (const entry of entries) {
        const { details, rest } = entryParts(entry)
        if (entry.heading || entry.subheading || entry.headingRight || entry.subheadingRight || details.length > 0) {
          blocks.push({ kind: "head", section, entry })
        }
        for (const line of rest) blocks.push({ kind: "item", section, entry, line })
      }
    }
  }
  return blocks
}

function Details({ sectionId, entry, template }: { sectionId: string; entry: ResumeEntry; template: TemplateId }) {
  const { details } = entryParts(entry)
  if (details.length === 0) return null
  const attrs = (d: Detail) => editAttrs({ kind: "item", sectionId, id: entry.id, index: d.index })
  if (template === "modern") {
    return (
      <div className="rv-details">
        {details.map((d, i) => (
          <p key={i} className={d.value ? undefined : "rv-details-wide"} {...attrs(d)}>
            <strong>{d.label}:</strong> {rich(d.value)}
          </p>
        ))}
      </div>
    )
  }
  const shown = details.filter((d) => d.value)
  if (shown.length === 0) return null
  return (
    <p className="rv-details-inline">
      {shown.map((d, i) => (
        <span key={i} {...attrs(d)}>
          {i > 0 && " · "}
          <strong>{d.label}:</strong> {rich(d.value)}
        </span>
      ))}
    </p>
  )
}

function EntryHeadLines({ entry, template }: { entry: ResumeEntry; template: TemplateId }) {
  if (template === "sidebar") {
    const { place } = dateAndPlace(entry)
    return (
      <div className="rv-line">
        <span>
          <strong>{entry.heading}</strong>
          {entry.heading && entry.subheading && " "}
          {entry.subheading}
        </span>
        <span className="rv-tl-place">{place}</span>
      </div>
    )
  }
  if (template === "bold") {
    const { place } = dateAndPlace(entry)
    return (
      <>
        {entry.heading && <strong className="rv-tl-title">{entry.heading}</strong>}
        {(entry.subheading || place) && (
          <div className="rv-tl-sub">
            <span className="rv-sc">{entry.subheading}</span>
            {entry.subheading && place && " · "}
            {place}
            {place && <Icon name="location" />}
          </div>
        )}
      </>
    )
  }
  // Classic/modern: an entry with nothing on the right (a project) is one line, "Name | tech stack".
  if (template !== "navy" && !entry.headingRight && !entry.subheadingRight) {
    if (!entry.heading && !entry.subheading) return null
    return (
      <div className="rv-line">
        <span>
          <strong>{entry.heading}</strong>
          {entry.heading && entry.subheading && <span className="rv-pipe"> | </span>}
          <em>{entry.subheading}</em>
        </span>
      </div>
    )
  }
  if (template === "modern") {
    const place = entry.subheadingRight
    const when = entry.headingRight
    return (
      <>
        {(entry.heading || entry.subheading) && (
          <div className="rv-line rv-caps">
            <strong>{entry.heading}</strong>
            <strong>{entry.subheading}</strong>
          </div>
        )}
        {(place || when) && (
          <div className="rv-line rv-meta">
            <span>
              {place && <Icon name={isDate(place) ? "calendar" : "location"} />}
              {place}
            </span>
            <span>
              {when && <Icon name={isDate(when) ? "calendar" : "location"} />}
              {when}
            </span>
          </div>
        )}
      </>
    )
  }
  return (
    <>
      {(entry.heading || entry.headingRight) && (
        <div className="rv-line">
          <strong>{entry.heading}</strong>
          <span className="rv-right-top">{entry.headingRight}</span>
        </div>
      )}
      {(entry.subheading || entry.subheadingRight) && (
        <div className="rv-line">
          <em>{entry.subheading}</em>
          <em>{entry.subheadingRight}</em>
        </div>
      )}
    </>
  )
}

type Indexed<T> = { block: T; index: number }

function itemAttrs(block: Extract<Block, { kind: "item" }>) {
  return editAttrs({ kind: "item", sectionId: block.section.id, id: block.entry.id, index: block.line.index })
}

/** The items of one entry on one page, as a bullet list or plain lines. */
function Items({ items, listStyle }: { items: Indexed<Extract<Block, { kind: "item" }>>[]; listStyle: ListStyle }) {
  if (items.length === 0) return null
  if (listStyle === "bullets") {
    return (
      <ul className="rv-bullets">
        {items.map(({ block, index }) =>
          block.line.text.startsWith("- ") ? (
            <li key={index} data-b={index} className="rv-sub" {...itemAttrs(block)}>
              {rich(block.line.text.slice(2))}
            </li>
          ) : (
            <li key={index} data-b={index} {...itemAttrs(block)}>
              {rich(block.line.text)}
            </li>
          ),
        )}
      </ul>
    )
  }
  return (
    <div className={listStyle === "italic" ? "rv-lines rv-italic" : "rv-lines"}>
      {items.map(({ block, index }) => (
        <p key={index} data-b={index} {...itemAttrs(block)}>
          {rich(block.line.text.startsWith("- ") ? block.line.text.slice(2) : block.line.text)}
        </p>
      ))}
    </div>
  )
}

/** One entry's blocks that landed on this page (the heading may be on an earlier page). */
function EntryPart({ blocks, template }: { blocks: Indexed<Block>[]; template: TemplateId }) {
  const first = blocks[0].block as Extract<Block, { kind: "head" | "item" }>
  const head = blocks.find((b) => b.block.kind === "head") as Indexed<Extract<Block, { kind: "head" }>> | undefined
  const items = blocks.filter((b) => b.block.kind === "item") as Indexed<Extract<Block, { kind: "item" }>>[]
  const { entry, section } = first
  const headAttrs = editAttrs({ kind: "head", sectionId: section.id, id: entry.id })

  const headEl = head && (
    <div data-b={head.index} {...headAttrs}>
      <EntryHeadLines entry={entry} template={template} />
      <Details sectionId={section.id} entry={entry} template={template} />
    </div>
  )

  if (hasSidebar(template)) {
    return (
      <div className="rv-tl">
        <div className="rv-tl-date" {...(head ? headAttrs : {})}>
          {head ? dateAndPlace(entry).date : ""}
        </div>
        <div className="rv-tl-body">
          {head && (
            <div data-b={head.index} {...headAttrs}>
              <EntryHeadLines entry={entry} template={template} />
              <div className="rv-tl-text">
                <Details sectionId={section.id} entry={entry} template={template} />
              </div>
            </div>
          )}
          <div className="rv-tl-text">
            <Items items={items} listStyle={section.listStyle} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rv-entry">
      {headEl}
      <Items items={items} listStyle={section.listStyle} />
    </div>
  )
}

/** Draws a run of blocks, grouping them back into sections and entries. */
function FlowBlocks({ blocks, indexes, template }: { blocks: Block[]; indexes: number[]; template: TemplateId }) {
  // Group consecutive blocks by section, then by entry within a section.
  const sections: { id: string; items: Indexed<Block>[] }[] = []
  for (const index of indexes) {
    const block = blocks[index]
    const last = sections[sections.length - 1]
    if (last && last.id === block.section.id) last.items.push({ block, index })
    else sections.push({ id: block.section.id, items: [{ block, index }] })
  }

  return (
    <>
      {sections.map(({ id, items }) => {
        const entryGroups: Indexed<Block>[][] = []
        for (const it of items) {
          if (it.block.kind !== "head" && it.block.kind !== "item") continue
          const entryId = it.block.entry.id
          const last = entryGroups[entryGroups.length - 1]
          const lastBlock = last?.[0].block as Extract<Block, { kind: "head" | "item" }> | undefined
          if (last && lastBlock?.entry.id === entryId) last.push(it)
          else entryGroups.push([it])
        }
        return (
          <section key={`${id}-${items[0].index}`} className="rv-section">
            {items.map(({ block, index }) => {
              if (block.kind === "title") {
                return (
                  <h2 key={index} data-b={index} {...editAttrs({ kind: "title", sectionId: id })}>
                    {block.section.title}
                  </h2>
                )
              }
              if (block.kind === "text") {
                return (
                  <p key={index} data-b={index} className="rv-text" {...editAttrs({ kind: "text", sectionId: id })}>
                    {rich(block.section.text)}
                  </p>
                )
              }
              if (block.kind === "table") {
                const rows = block.section.rows.filter((r) => r.label || r.value)
                return template === "navy" ? (
                  <table key={index} data-b={index} className="rv-table">
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id} {...editAttrs({ kind: "row", sectionId: id, id: row.id })}>
                          <th>{row.label}</th>
                          <td>{rich(row.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div key={index} data-b={index} className="rv-skill-lines">
                    {rows.map((row) => (
                      <p key={row.id} {...editAttrs({ kind: "row", sectionId: id, id: row.id })}>
                        {row.label && <strong>{row.label}: </strong>}
                        {rich(row.value)}
                      </p>
                    ))}
                  </div>
                )
              }
              return null
            })}
            {entryGroups.map((group) => (
              <EntryPart key={group[0].index} blocks={group} template={template} />
            ))}
          </section>
        )
      })}
    </>
  )
}

// ---- Two-column templates (sidebar, bold) ----------------------------------

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "?"
  return ((words[0][0] ?? "") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase()
}

function SideSection({ section, template }: { section: ResumeSection; template: TemplateId }) {
  if (section.kind === "entries") return null
  const empty = section.kind === "text" ? !section.text : section.rows.every((r) => !r.label && !r.value)
  if (empty) return null
  return (
    <section className="rv-side-section">
      <h2 {...editAttrs({ kind: "title", sectionId: section.id })}>
        <span>{section.title}</span>
      </h2>
      {section.kind === "text" ? (
        <p {...editAttrs({ kind: "text", sectionId: section.id })}>{rich(section.text)}</p>
      ) : (
        section.rows
          .filter((r) => r.label || r.value)
          .map((row) => (
            <p key={row.id} {...editAttrs({ kind: "row", sectionId: section.id, id: row.id })}>
              {row.label && <strong>{row.label}{template === "sidebar" ? ": " : <br />}</strong>}
              {rich(row.value)}
            </p>
          ))
      )}
    </section>
  )
}

function SideContact({ contact, template }: { contact: ContactItem[]; template: TemplateId }) {
  if (contact.length === 0) return null
  return (
    <div className={template === "sidebar" ? "rv-side-contact" : "rv-side-contact rv-side-contact-bottom"}>
      {contact.map((item) => (
        <p key={item.id} {...editAttrs({ kind: "contact", id: item.id })}>
          <span className="rv-bubble">
            <Icon name={iconFor(item)} />
          </span>
          <span>{breakable(item.value)}</span>
        </p>
      ))}
    </div>
  )
}

/** Lets a long email or URL wrap after "@" or "/" in a narrow column, instead of mid-word. */
function breakable(value: string): ReactNode {
  return value.split(/(?<=[@/])/).map((part, i) => (
    <span key={i}>
      {i > 0 && <wbr />}
      {part}
    </span>
  ))
}

// ---- Pages -----------------------------------------------------------------

/**
 * One sheet. `indexes` are the flow blocks on it; the name/contact header (and
 * in two-column templates, the band and the sidebar's content) only go on the
 * first page. `paged` fixes the sheet to exactly one A4 page.
 */
export function ResumePage({
  data,
  blocks,
  indexes,
  first,
  paged = false,
}: {
  data: ResumeData
  blocks: Block[]
  indexes: number[]
  first: boolean
  paged?: boolean
}) {
  const template = data.template ?? "navy"
  const contact = data.contact.filter((c) => c.value)
  const className = `rv-page rv-${template}${paged ? " rv-paged" : ""}`

  if (hasSidebar(template)) {
    const nameWords = (data.name || "Your Name").trim().split(/\s+/)
    return (
      <article className={className}>
        {template === "bold" && first && (
          <header className="rv-band">
            <h1 className="rv-name" {...editAttrs({ kind: "name" })}>
              {nameWords.length > 1 && <span className="rv-light">{nameWords.slice(0, -1).join(" ")} </span>}
              {nameWords[nameWords.length - 1]}
            </h1>
            {data.tagline && (
              <p className="rv-tagline" {...editAttrs({ kind: "tagline" })}>
                {data.tagline}
              </p>
            )}
          </header>
        )}
        <div className="rv-cols">
          <aside className="rv-side">
            {first && (
              <>
                <div className="rv-avatar">{initials(data.name)}</div>
                {template === "sidebar" && (
                  <>
                    <h1 className="rv-name" {...editAttrs({ kind: "name" })}>
                      {data.name || "Your Name"}
                    </h1>
                    {data.tagline && (
                      <p className="rv-tagline" {...editAttrs({ kind: "tagline" })}>
                        {data.tagline}
                      </p>
                    )}
                    <SideContact contact={contact} template={template} />
                  </>
                )}
                {data.sections.map((section) => (
                  <SideSection key={section.id} section={section} template={template} />
                ))}
                {template === "bold" && <SideContact contact={contact} template={template} />}
              </>
            )}
          </aside>
          <main className="rv-main">
            <FlowBlocks blocks={blocks} indexes={indexes} template={template} />
          </main>
        </div>
      </article>
    )
  }

  return (
    <article className={className}>
      {first && (
        <>
          <h1 className="rv-name" {...editAttrs({ kind: "name" })}>
            {data.name || "Your Name"}
          </h1>
          {data.tagline && (
            <p className="rv-tagline" {...editAttrs({ kind: "tagline" })}>
              {data.tagline}
            </p>
          )}
          <Contact contact={contact} template={template} />
        </>
      )}
      <FlowBlocks blocks={blocks} indexes={indexes} template={template} />
    </article>
  )
}

/** The whole resume on one sheet that grows as needed (marketing previews, and paging's measuring copy). */
export function ResumePreview({ data }: { data: ResumeData }) {
  const blocks = flowBlocks(data)
  return <ResumePage data={data} blocks={blocks} indexes={blocks.map((_, i) => i)} first />
}
