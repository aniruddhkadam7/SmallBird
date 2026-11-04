import { strFromU8, unzipSync } from "fflate"

// Plain text out of a .docx: it is a zip whose word/document.xml holds the
// text. Paragraph and line breaks are kept and the XML tags dropped, the same
// scope as the desktop app's extraction (src-tauri/src/documents.rs).

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'" }

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name])
    .replace(/&amp;/g, "&") // last, so "&amp;lt;" becomes "&lt;" and not "<"
}

export function extractDocxText(data: Uint8Array): string {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(data, { filter: (file) => file.name === "word/document.xml" })
  } catch {
    throw new Error("That doesn't look like a valid .docx file.")
  }
  const xml = files["word/document.xml"]
  if (!xml) throw new Error("That .docx file has no readable content.")

  const withBreaks = strFromU8(xml)
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
  return decodeEntities(withBreaks.replace(/<[^>]+>/g, ""))
}
