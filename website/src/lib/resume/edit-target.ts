// What a click on a line of the resume preview edits. resume-preview.tsx puts
// these as data-* attributes on each line it draws; the editor reads them back
// from the clicked element (app/resume/[id]/line-editor.tsx).

export type EditTarget =
  | { kind: "name" }
  | { kind: "tagline" }
  | { kind: "contact"; id: string }
  | { kind: "title"; sectionId: string }
  | { kind: "text"; sectionId: string }
  | { kind: "row"; sectionId: string; id: string }
  | { kind: "head"; sectionId: string; id: string }
  /** `index` is the line's position in entry.items, blanks included. */
  | { kind: "item"; sectionId: string; id: string; index: number }

export function editAttrs(target: EditTarget): Record<string, string> {
  const attrs: Record<string, string> = { "data-edit": target.kind }
  if ("sectionId" in target) attrs["data-section"] = target.sectionId
  if ("id" in target) attrs["data-id"] = target.id
  if ("index" in target) attrs["data-item"] = String(target.index)
  return attrs
}

export function readEditTarget(el: HTMLElement): EditTarget | null {
  const { edit: kind, section: sectionId = "", id = "", item } = el.dataset
  switch (kind) {
    case "name":
    case "tagline":
      return { kind }
    case "contact":
      return { kind, id }
    case "title":
    case "text":
      return { kind, sectionId }
    case "row":
    case "head":
      return { kind, sectionId, id }
    case "item":
      return { kind, sectionId, id, index: Number(item) }
    default:
      return null
  }
}
