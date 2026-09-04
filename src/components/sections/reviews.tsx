"use client"

import { useEffect, useRef, useState } from "react"
import { motion } from "motion/react"
import { ChevronLeft, ChevronRight, Star } from "lucide-react"

function colorForName(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i)
    hash |= 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 65%, 45%)`
}

const testimonials = [
  {
    name: "Ananya Sharma",
    role: "Software Engineer, Bengaluru",
    quote:
      "I froze on a system design question halfway through and Smallbird nudged me toward the right trade-offs without it feeling scripted. Got the offer a week later.",
  },
  {
    name: "Rohan Mehta",
    role: "Product Manager, Pune",
    quote:
      "The context from my resume actually showed up in real time — when they asked about a project I'd forgotten details of, the right numbers were right there.",
  },
  {
    name: "Priya Iyer",
    role: "Data Analyst, Chennai",
    quote:
      "Switching from a non-analytics role, I was nervous about SQL questions. Having quiet, real-time help meant I could focus on explaining my thinking instead of panicking.",
  },
  {
    name: "Arjun Nair",
    role: "Backend Developer, Hyderabad",
    quote:
      "Six interviews in two weeks. Smallbird kept the context of each company loaded so I never mixed up which role I was even talking about.",
  },
  {
    name: "Sneha Reddy",
    role: "UX Designer, Mumbai",
    quote:
      "It's subtle — not answers being fed to you, more like a second brain keeping track of what you already said so you stay consistent.",
  },
  {
    name: "Vikram Singh",
    role: "DevOps Engineer, Gurugram",
    quote:
      "First interview after a career break. The AI notes mode kept me from rambling and helped me land on concrete examples instead of vague answers.",
  },
  {
    name: "Kavya Krishnan",
    role: "Business Analyst, Kochi",
    quote:
      "Genuinely didn't expect it to feel this natural during a live call. Nobody on the other end could tell I had anything running.",
  },
]

export function Reviews() {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const dragState = useRef({ startX: 0, startScrollLeft: 0 })

  // A plain vertical mouse wheel doesn't move a horizontal flex row on its
  // own -- only trackpad horizontal swipes do -- so this remaps normal
  // wheel scrolling onto scrollLeft while the pointer is over the track.
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      el.scrollLeft += e.deltaY
      e.preventDefault()
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    const el = trackRef.current
    if (!el) return
    setDragging(true)
    dragState.current = { startX: e.clientX, startScrollLeft: el.scrollLeft }
    el.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const el = trackRef.current
    if (!el) return
    el.scrollLeft = dragState.current.startScrollLeft - (e.clientX - dragState.current.startX)
  }

  const scrollByCards = (direction: 1 | -1) => {
    trackRef.current?.scrollBy({ left: direction * 340, behavior: "smooth" })
  }

  return (
    <section id="reviews" className="border-t border-border py-20 sm:py-28">
      <div className="mx-auto max-w-5xl px-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Loved by <span className="text-primary">candidates</span> across India
            </h2>
            <p className="mt-4 text-muted-foreground">
              A few example reviews on how Smallbird has helped people through real interviews.
            </p>
          </div>
          <div className="hidden shrink-0 gap-2 sm:flex">
            <button
              type="button"
              onClick={() => scrollByCards(-1)}
              aria-label="Scroll reviews left"
              className="glass-subtle flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-opacity hover:opacity-70"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => scrollByCards(1)}
              aria-label="Scroll reviews right"
              className="glass-subtle flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-opacity hover:opacity-70"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragging(false)}
        onPointerLeave={() => setDragging(false)}
        className={`mt-14 flex gap-5 overflow-x-auto px-4 pb-4 [scrollbar-width:none] sm:px-[max(1rem,calc((100vw-64rem)/2))] [&::-webkit-scrollbar]:hidden ${
          dragging ? "cursor-grabbing select-none" : "cursor-grab"
        }`}
      >
        {testimonials.map((t) => (
          <div
            key={t.name}
            className="glass flex w-[280px] shrink-0 flex-col gap-4 rounded-xl p-5 sm:w-[320px]"
          >
            <div className="flex gap-0.5 text-primary">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="h-3.5 w-3.5 fill-current" />
              ))}
            </div>
            <p className="flex-1 text-sm leading-relaxed text-foreground">&ldquo;{t.quote}&rdquo;</p>
            <div className="flex items-center gap-2.5">
              <span
                style={{ backgroundColor: colorForName(t.name) }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium text-white"
              >
                {t.name.charAt(0)}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{t.name}</div>
                <div className="truncate text-xs text-muted-foreground">{t.role}</div>
              </div>
            </div>
          </div>
        ))}
      </motion.div>
    </section>
  )
}
