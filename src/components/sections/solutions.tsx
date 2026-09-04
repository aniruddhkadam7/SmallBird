import Link from "next/link"
import { ArrowRight } from "lucide-react"

const solutions = [
  {
    href: "/ai-interview-assistant",
    label: "AI Interview Assistant",
    description: "How Smallbird listens and helps during a live interview.",
  },
  {
    href: "/ai-interview-copilot",
    label: "AI Interview Copilot",
    description: "Suggestions, not a script — you stay in control.",
  },
  {
    href: "/ai-coding-interview-assistant",
    label: "AI Coding Interview Assistant",
    description: "Help with the verbal side of technical rounds.",
  },
  {
    href: "/ai-meeting-assistant",
    label: "AI Meeting Assistant",
    description: "The same real-time assistance, on any video call.",
  },
]

export function Solutions() {
  return (
    <section id="solutions" className="border-t border-border py-14 px-4 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Built for how you actually use it</h2>
          <p className="mt-4 text-muted-foreground">
            Same underlying assistant, tuned to what you&apos;re walking into.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {solutions.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-2xl border border-border p-5 transition-colors hover:border-foreground/30"
            >
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                {item.label}
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
              <p className="mt-1.5 text-sm text-muted-foreground">{item.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
