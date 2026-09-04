"use client"

import { Star } from "lucide-react"

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
    rating: 5,
    quote:
      "I froze on a system design question halfway through and Smallbird nudged me toward the right trade-offs without it feeling scripted. Got the offer a week later.",
  },
  {
    name: "Rohan Mehta",
    role: "Product Manager, Pune",
    rating: 4,
    quote:
      "The context from my resume actually showed up in real time — when they asked about a project I'd forgotten details of, the right numbers were right there.",
  },
  {
    name: "Priya Iyer",
    role: "Data Analyst, Chennai",
    rating: 5,
    quote:
      "Switching from a non-analytics role, I was nervous about SQL questions. Having quiet, real-time help meant I could focus on explaining my thinking instead of panicking.",
  },
  {
    name: "Arjun Nair",
    role: "Backend Developer, Hyderabad",
    rating: 4,
    quote:
      "Six interviews in two weeks. Smallbird kept the context of each company loaded so I never mixed up which role I was even talking about.",
  },
  {
    name: "Sneha Reddy",
    role: "UX Designer, Mumbai",
    rating: 5,
    quote:
      "It's subtle — not answers being fed to you, more like a second brain keeping track of what you already said so you stay consistent.",
  },
  {
    name: "Vikram Singh",
    role: "DevOps Engineer, Gurugram",
    rating: 4,
    quote:
      "First interview after a career break. The AI notes mode kept me from rambling and helped me land on concrete examples instead of vague answers.",
  },
  {
    name: "Kavya Krishnan",
    role: "Business Analyst, Kochi",
    rating: 5,
    quote:
      "Genuinely didn't expect it to feel this natural during a live call. Nobody on the other end could tell I had anything running.",
  },
]

function ReviewCard({ t }: { t: (typeof testimonials)[number] }) {
  return (
    <div className="glass flex w-[280px] shrink-0 flex-col gap-4 rounded-xl p-5 sm:w-[320px]">
      <div className="flex gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            className={
              i < t.rating
                ? "h-3.5 w-3.5 fill-amber-400 text-amber-400"
                : "h-3.5 w-3.5 fill-transparent text-muted-foreground/40"
            }
          />
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
  )
}

export function Reviews() {
  return (
    <section id="reviews" className="border-t border-border py-14 sm:py-20">
      <div className="mx-auto max-w-5xl px-4 text-center">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Loved by <span className="text-primary">candidates</span> across India
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
          A few example reviews on how Smallbird has helped people through real interviews.
        </p>
      </div>

      <div
        className="relative mt-14 overflow-hidden"
        style={{
          maskImage: "linear-gradient(to right, transparent, black 5%, black 95%, transparent)",
          WebkitMaskImage: "linear-gradient(to right, transparent, black 5%, black 95%, transparent)",
        }}
      >
        <div className="animate-marquee flex w-max gap-5">
          {[...testimonials, ...testimonials].map((t, i) => (
            <ReviewCard key={`${t.name}-${i}`} t={t} />
          ))}
        </div>
      </div>
    </section>
  )
}
