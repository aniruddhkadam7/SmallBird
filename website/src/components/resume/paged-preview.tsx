"use client"

import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { flowBlocks, ResumePage, type Block } from "./resume-preview"
import type { ResumeData } from "@/lib/resume/types"

// Splits a resume into real A4 pages, the same ones that print. A hidden copy
// is drawn as one long sheet; the top of every block (see resume-preview.tsx)
// is measured there, and blocks are packed into 297mm pages in order. A
// section title or an entry's heading is never left alone at the bottom of a
// page — it moves to the next page with the line it introduces.

const MM = 96 / 25.4
const PAGE_HEIGHT = 297 * MM
/** A little room for rounding, so the last line on a page can never be clipped. */
const SAFETY = 4
/** Room for the gap a section/entry adds above the first block of a new page. */
const LEAD = 20

function paginate(blocks: Block[], tops: number[], bottoms: number[], padTop: number, padBottom: number): number[][] {
  const limit = PAGE_HEIGHT - padBottom - SAFETY
  const pages: number[][] = [[]]
  // Where the current page's first block sits in the long sheet, and where it
  // will sit on its own page (the first page keeps the header above it).
  let offset = 0

  for (let i = 0; i < blocks.length; i++) {
    const page = pages[pages.length - 1]
    if (bottoms[i] - offset <= limit || page.length === 0) {
      page.push(i)
      continue
    }
    // Carry a trailing title / entry heading over with the block it introduces.
    const carry: number[] = []
    while (page.length > 1) {
      const last = blocks[page[page.length - 1]]
      const introduces =
        last.kind === "title" ||
        (last.kind === "head" && blocks[i].kind === "item" && blocks[i].section.id === last.section.id)
      if (!introduces) break
      carry.unshift(page.pop()!)
    }
    const next = [...carry, i]
    pages.push(next)
    offset = tops[next[0]] - padTop - LEAD
  }
  return pages
}

export function PagedResumePreview({ data, zoom = 1 }: { data: ResumeData; zoom?: number }) {
  const blocks = useMemo(() => flowBlocks(data), [data])
  const allIndexes = useMemo(() => blocks.map((_, i) => i), [blocks])
  const measureRef = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<number[][]>([allIndexes])

  useLayoutEffect(() => {
    let cancelled = false
    const measure = () => {
      const root = measureRef.current
      if (cancelled || !root) return
      const article = root.querySelector<HTMLElement>(".rv-page")
      if (!article) return
      // The column the blocks flow in: the main column in two-column templates.
      const flow = article.querySelector<HTMLElement>(".rv-main") ?? article
      const style = getComputedStyle(flow)
      const base = article.getBoundingClientRect().top
      const tops: number[] = []
      const bottoms: number[] = []
      for (let i = 0; i < blocks.length; i++) {
        const el = article.querySelector<HTMLElement>(`[data-b="${i}"]`)
        const rect = el?.getBoundingClientRect()
        tops.push(rect ? rect.top - base : tops[i - 1] ?? 0)
        bottoms.push(rect ? rect.bottom - base : bottoms[i - 1] ?? 0)
      }
      // Later pages start the flow at the column's own top padding (no header).
      const padTop = parseFloat(style.paddingTop) || 0
      const padBottom = parseFloat(style.paddingBottom) || 0
      const next = blocks.length === 0 ? [[]] : paginate(blocks, tops, bottoms, padTop, padBottom)
      setPages((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    measure()
    // Fonts arriving late change line wrapping, so measure again once they're in.
    document.fonts?.ready.then(measure)
    return () => {
      cancelled = true
    }
  }, [blocks])

  // A stale page list (from before an edit) could point past the new blocks.
  const safePages = pages.flat().some((i) => i >= blocks.length) ? [allIndexes] : pages

  return (
    <>
      <div ref={measureRef} aria-hidden="true" className="rb-chrome rv-measure">
        <ResumePage data={data} blocks={blocks} indexes={allIndexes} first />
      </div>
      <div className="rv-pages" style={{ zoom }}>
        {safePages.map((indexes, p) => (
          <div key={p} className="rv-page-wrap">
            {safePages.length > 1 && (
              <div className="rb-chrome rv-page-label">
                Page {p + 1} of {safePages.length}
              </div>
            )}
            <div className="rv-sheet">
              <ResumePage data={data} blocks={blocks} indexes={indexes} first={p === 0} paged />
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
