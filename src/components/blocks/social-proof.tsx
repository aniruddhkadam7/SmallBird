"use client"

import { useEffect, useState, type ReactNode } from "react"
import Image from "next/image"
import { Star } from "lucide-react"
import { cn } from "@/lib/utils"
import avatar1 from "@/assets/avatar-1.jpg"
import avatar2 from "@/assets/avatar-2.jpg"
import avatar3 from "@/assets/avatar-3.jpg"

// Fill these in only with real figures (e.g. the signed-up user count from
// Supabase, or an average from collected reviews). While they're unset the
// badge shows wording that's true today instead of a number.
const REAL_USER_COUNT: string | null = null // e.g. "2,000+"
const REAL_RATING: { average: string; reviews: string } | null = null // e.g. { average: "4.7", reviews: "120" }

const ROTATE_MS = 3500
const SLIDE_MS = 700

const avatars = [avatar1, avatar2, avatar3]

function Pill({ icon, title, subtitle }: { icon: ReactNode; title: ReactNode; subtitle: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white/70 py-1 pr-3.5 pl-1 shadow-sm backdrop-blur">
      {icon}
      <div className="flex flex-col items-start text-left leading-tight">
        <p className="whitespace-nowrap text-[13px] text-foreground">{title}</p>
        <div className="whitespace-nowrap text-[11px] text-muted-foreground">{subtitle}</div>
      </div>
    </div>
  )
}

function UsersPill() {
  return (
    <Pill
      icon={
        <div className="flex -space-x-2">
          {avatars.map((src, i) => (
            <Image
              key={i}
              src={src}
              alt=""
              aria-hidden
              width={28}
              height={28}
              priority
              className="h-7 w-7 rounded-full border-2 border-white object-cover"
            />
          ))}
        </div>
      }
      title={
        REAL_USER_COUNT ? (
          <>
            Trusted by <span className="font-semibold">{REAL_USER_COUNT}</span> people
          </>
        ) : (
          <>
            Used by <span className="font-semibold">job seekers in India</span>
          </>
        )
      }
      subtitle={
        <span className="flex items-center gap-1">
          <span className="flex" aria-hidden>
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} className="h-3 w-3 fill-amber-400 text-amber-400" />
            ))}
          </span>
          {REAL_RATING ? (
            <span>
              <span className="font-semibold text-foreground">{REAL_RATING.average}</span> · from{" "}
              {REAL_RATING.reviews} reviews
            </span>
          ) : (
            "Made for real interviews"
          )}
        </span>
      }
    />
  )
}

// One gold laurel branch; `flip` mirrors it for the right-hand side.
function LaurelBranch({ flip = false }: { flip?: boolean }) {
  const leaves = [
    { x: 14.5, y: 33, r: -20 },
    { x: 10.5, y: 27.5, r: -30 },
    { x: 8, y: 21, r: -12 },
    { x: 7.5, y: 14.5, r: 0 },
    { x: 9, y: 8, r: 18 },
  ]
  return (
    <svg
      viewBox="0 0 22 40"
      className={cn("h-9 w-auto shrink-0", flip && "-scale-x-100")}
      aria-hidden
    >
      <defs>
        <linearGradient id="laurel-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e2b53e" />
          <stop offset="100%" stopColor="#b8861b" />
        </linearGradient>
      </defs>
      <path d="M17 39 C 8 32, 5 20, 11 3" fill="none" stroke="url(#laurel-gold)" strokeWidth="1.3" strokeLinecap="round" />
      {leaves.map((l, i) => (
        <g key={i}>
          <ellipse cx={l.x - 3.2} cy={l.y} rx="1.9" ry="3.9" transform={`rotate(${l.r - 35} ${l.x - 3.2} ${l.y})`} fill="url(#laurel-gold)" />
          <ellipse cx={l.x + 3} cy={l.y - 1.5} rx="1.7" ry="3.5" transform={`rotate(${l.r + 35} ${l.x + 3} ${l.y - 1.5})`} fill="url(#laurel-gold)" />
        </g>
      ))}
      <ellipse cx="11.5" cy="2.8" rx="1.6" ry="3" transform="rotate(20 11.5 2.8)" fill="url(#laurel-gold)" />
    </svg>
  )
}

function IndiaLaurel() {
  return (
    <div className="inline-flex items-center gap-1.5 px-1">
      <LaurelBranch />
      <div className="flex flex-col items-center leading-tight">
        {/* Keep this factual: a "No. 1" / "Top" ranking needs a real, citable
            source (ASCI rules on superlative claims) before it goes here. */}
        <p className="whitespace-nowrap text-[13px] font-semibold text-foreground">Loved across India</p>
        <p className="whitespace-nowrap text-[11px] text-muted-foreground">AI interview app</p>
      </div>
      <LaurelBranch flip />
    </div>
  )
}

const slides = [UsersPill, IndiaLaurel]

// A horizontal carousel: the badges sit side by side in one strip that
// scrolls left, so they never overlap. A copy of the first badge sits at the
// end; after scrolling onto it the strip jumps back to the start without a
// transition, so the loop always moves the same direction. An invisible
// stacked copy of every badge sizes the box to the widest one, so the
// headline below never moves.
export function SocialProof({ className }: { className?: string }) {
  const [index, setIndex] = useState(0)
  const [animate, setAnimate] = useState(true)
  const track = [...slides, slides[0]]

  useEffect(() => {
    const id = setInterval(() => {
      setAnimate(true)
      setIndex((i) => i + 1)
    }, ROTATE_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <div className={cn("relative grid overflow-hidden", className)}>
      {slides.map((Slide, i) => (
        <div key={i} aria-hidden className="invisible col-start-1 row-start-1 flex h-10 items-center px-3 md:pr-6 md:pl-0">
          <Slide />
        </div>
      ))}
      <div
        className="absolute inset-0 flex motion-reduce:transition-none!"
        style={{
          transform: `translateX(-${index * 100}%)`,
          transition: animate ? `transform ${SLIDE_MS}ms ease-in-out` : "none",
        }}
        onTransitionEnd={() => {
          if (index === slides.length) {
            setAnimate(false)
            setIndex(0)
          }
        }}
      >
        {track.map((Slide, i) => (
          <div
            key={i}
            aria-hidden={i % slides.length !== index % slides.length || i === slides.length}
            className="flex h-10 w-full shrink-0 items-center justify-center px-3 md:justify-start md:pr-6 md:pl-0"
          >
            <Slide />
          </div>
        ))}
      </div>
    </div>
  )
}
