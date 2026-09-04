"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { MoveHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import candidateView from "@/assets/pov-candidate.png"
import interviewerView from "@/assets/pov-interviewer.png"

export function PovCompare({ className, compact = false }: { className?: string; compact?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(50)
  const [dragging, setDragging] = useState(false)
  const [autoPlaying, setAutoPlaying] = useState(true)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Sweeps the divider back and forth continuously until the user grabs
  // it -- once they've dragged once, they're in control for good.
  useEffect(() => {
    if (!autoPlaying) return
    let frame: number
    const start = performance.now()
    const tick = (now: number) => {
      const t = (now - start) / 1000
      setPosition(50 + Math.sin(t * 0.8) * 32)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [autoPlaying])

  const updateFromClientX = (clientX: number) => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pct = ((clientX - rect.left) / rect.width) * 100
    setPosition(Math.min(100, Math.max(0, pct)))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    setAutoPlaying(false)
    setDragging(true)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    updateFromClientX(e.clientX)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    updateFromClientX(e.clientX)
  }

  const handleSize = compact ? "h-7 w-7" : "h-10 w-10"
  const captionClass = compact ? "text-xs" : "text-sm"

  return (
    <div className="flex flex-col gap-2.5">
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragging(false)}
        onPointerLeave={() => setDragging(false)}
        className={cn(
          "relative aspect-[1616/973] w-full cursor-ew-resize touch-none select-none overflow-hidden rounded-2xl",
          className,
        )}
      >
        {/* Base layer: interviewer's view */}
        <Image
          src={interviewerView}
          alt="Interviewer view of the call"
          fill
          sizes="(min-width: 768px) 768px, 100vw"
          className="pointer-events-none object-cover"
        />

        {/* Clipped top layer: candidate's view */}
        <div className="absolute inset-0 overflow-hidden" style={{ width: `${position}%` }}>
          <div className="absolute inset-y-0 left-0" style={{ width: containerWidth || 2000 }}>
            <Image
              src={candidateView}
              alt="Candidate view of the call"
              fill
              sizes="(min-width: 768px) 768px, 100vw"
              className="pointer-events-none object-cover"
            />
          </div>
        </div>

        {/* Divider handle */}
        <div className="pointer-events-none absolute inset-y-0 z-10" style={{ left: `${position}%` }}>
          <div className="animate-divider-glow absolute inset-y-0 -translate-x-1/2 border-l-2 border-white/90" />
          <div
            className={cn(
              "animate-divider-glow absolute top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full bg-white text-neutral-900",
              handleSize,
            )}
          >
            <MoveHorizontal className={compact ? "h-3 w-3" : "h-4 w-4"} />
          </div>
        </div>
      </div>

      <div className={cn("flex items-center justify-between px-0.5 font-medium text-muted-foreground", captionClass)}>
        <span>Candidate view</span>
        <span>Interviewer view</span>
      </div>
    </div>
  )
}
