import { extractDocxText } from "./docx"

// Reads a CV or job description into plain text on the phone itself: the file
// is never uploaded anywhere, only the extracted text is kept (in this
// browser) and sent along with each question as background. Same formats as
// the desktop app: PDF, DOCX, TXT and MD.

export const DOCUMENT_ACCEPT =
  ".pdf,.docx,.txt,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"

const MAX_FILE_BYTES = 10 * 1024 * 1024

export interface ExtractedDocument {
  filename: string
  text: string
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".")
  return dot < 0 ? "" : filename.slice(dot + 1).toLowerCase()
}

/** Tidies extracted text: consistent newlines, no runs of blank lines or spaces. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Throws an Error whose message is safe to show the user as-is. */
export async function readDocument(file: File): Promise<ExtractedDocument> {
  if (file.size > MAX_FILE_BYTES) throw new Error("That file is too large. Please use one under 10 MB.")

  const ext = extensionOf(file.name)
  let raw: string
  switch (ext) {
    case "txt":
    case "md":
    case "markdown":
      raw = await file.text()
      break
    case "pdf": {
      const { extractPdfText } = await import("./pdf")
      // A URL, not an import: the browser loads the worker script itself, only when it is needed.
      const workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString()
      raw = await extractPdfText(new Uint8Array(await file.arrayBuffer()), workerSrc)
      break
    }
    case "docx":
      raw = extractDocxText(new Uint8Array(await file.arrayBuffer()))
      break
    case "doc":
      throw new Error("Old .doc files aren't supported. Save it as .docx or PDF and upload that.")
    default:
      throw new Error("Please upload a PDF, DOCX, TXT or MD file.")
  }

  const text = normalizeText(raw)
  if (!text) {
    throw new Error(
      ext === "pdf"
        ? "We couldn't find any text in that PDF. If it's a scan or photo, upload a PDF exported from Word or Google Docs, or a .docx."
        : "That file has no text in it.",
    )
  }
  return { filename: file.name, text }
}
