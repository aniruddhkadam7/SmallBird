// Plain text out of a PDF, in the browser. Uses pdf.js's "legacy" build, which
// also runs on older iPhones (the current build needs newer JavaScript than
// iOS Safari before 17.4 has). Loaded only when someone actually picks a PDF.

/** A CV is a page or two; this only stops a huge file from freezing the phone. */
const MAX_PAGES = 20

interface TextItem {
  str: string
  hasEOL?: boolean
}

/**
 * `workerSrc` is the URL of pdf.js's worker script; the browser wrapper
 * (documents.ts) supplies it. Node (used by the tests) finds it on its own.
 */
export async function extractPdfText(data: Uint8Array, workerSrc?: string): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  if (workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

  let doc
  try {
    doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  } catch (err) {
    if (err instanceof Error && err.name === "PasswordException") {
      throw new Error("This PDF is password-protected. Save an unprotected copy and upload that.")
    }
    throw new Error("We couldn't read that PDF. Try re-saving it as a PDF, or upload a .docx instead.")
  }

  try {
    const pages: string[] = []
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      const text = (content.items as TextItem[]).map((item) => item.str + (item.hasEOL ? "\n" : " ")).join("")
      pages.push(text)
    }
    return pages.join("\n\n")
  } finally {
    await doc.destroy()
  }
}
