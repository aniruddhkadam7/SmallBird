import type { Metadata } from "next"
import { EyeOff } from "lucide-react"
import { PageHeader } from "@/components/blocks/page-header"
import { FaqSection } from "@/components/blocks/faq-section"
import { RelatedPages } from "@/components/blocks/related-pages"
import { CtaBanner } from "@/components/blocks/cta-banner"

export const metadata: Metadata = {
  title: "AI Coding Interview Assistant",
  description:
    "Smallbird helps with the verbal side of coding interviews — explaining your approach, trade-offs, and reasoning out loud — grounded in your CV and the job description. It does not read your code editor or screen.",
  alternates: { canonical: "/ai-coding-interview-assistant" },
}

const faqs = [
  {
    question: "Does Smallbird read my code or see my screen?",
    answer:
      "No. Smallbird works from what's said out loud during the interview, not from your code editor or screen. It doesn't take screenshots or read what you're typing. If you're looking for a tool that analyzes your on-screen code, Smallbird isn't that — it's built around the spoken, conversational half of a coding interview.",
  },
  {
    question: "Then how does it help in a coding interview?",
    answer:
      "A large part of a coding interview is verbal even while you're writing code: explaining your approach before you start, talking through trade-offs, answering \"why did you choose that data structure,\" discussing time and space complexity, and responding to follow-up questions. Smallbird listens to that conversation and surfaces relevant, context-aware points as it happens.",
  },
  {
    question: "What context does it use for a coding interview?",
    answer:
      "The same context as any Smallbird session — your CV and the job description you load in beforehand. That grounds its suggestions in your actual background (languages, past projects, seniority level) rather than generic interview advice.",
  },
  {
    question: "Will it be visible to the interviewer if I share my screen?",
    answer:
      "No. Smallbird's overlay is a separate window from your call and IDE. Sharing your screen during a live coding round shows your code and call as normal — the overlay isn't part of what's shared.",
  },
  {
    question: "Is this useful for system design interviews too?",
    answer:
      "Yes — system design rounds are almost entirely verbal discussion, which is exactly where Smallbird's live, conversation-based assistance applies most directly.",
  },
]

export default function AiCodingInterviewAssistantPage() {
  return (
    <div className="pb-8">
      <PageHeader
        eyebrow="AI Coding Interview Assistant"
        title="AI assistance for the conversation in a coding interview"
        description="Coding interviews aren't silent — you're expected to talk through your approach, defend your trade-offs, and answer follow-ups out loud. Smallbird listens to that conversation and helps, without ever looking at your screen or your code."
      />

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <div className="flex gap-3 rounded-2xl border border-border bg-foreground/[0.02] p-5">
          <EyeOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <h2 className="font-medium text-foreground">What Smallbird does not do</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              It does not see your code editor, IDE, or screen, and it does not read or analyze the code
              you write. Everything it responds to comes from audio — the conversation happening out
              loud — plus the CV and job description you&apos;ve loaded in ahead of time.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">Where this actually helps</h2>
        <ul className="mt-4 space-y-3 text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Explaining your approach before you code —</span>{" "}
            talking through how you&apos;d tackle the problem, out loud, before touching the keyboard.
          </li>
          <li>
            <span className="font-medium text-foreground">Defending trade-offs —</span>{" "}
            answering &quot;why this data structure&quot; or &quot;why not recursion here&quot; as the interviewer probes your reasoning.
          </li>
          <li>
            <span className="font-medium text-foreground">Complexity discussion —</span>{" "}
            responding to questions about time and space complexity once you&apos;ve written a solution.
          </li>
          <li>
            <span className="font-medium text-foreground">System design conversations —</span>{" "}
            rounds that are close to entirely verbal, with little or no code involved.
          </li>
        </ul>
      </section>

      <FaqSection items={faqs} />

      <RelatedPages
        links={[
          {
            href: "/ai-interview-assistant",
            label: "AI Interview Assistant",
            description: "The full picture of how Smallbird works during any interview.",
          },
          {
            href: "/ai-interview-copilot",
            label: "AI Interview Copilot",
            description: "Why Smallbird surfaces suggestions instead of scripted answers.",
          },
          {
            href: "/features/real-time-ai",
            label: "Real-Time AI",
            description: "How the live transcription and response pipeline works.",
          },
          {
            href: "/best-coding-interview-tools",
            label: "Best Coding Interview Tools",
            description: "The screen-reading vs. conversation-based trade-off, explained.",
          },
          {
            href: "/smallbird-alternatives",
            label: "Smallbird Alternatives",
            description: "How Smallbird compares to code-reading interview tools.",
          },
          {
            href: "/pricing",
            label: "Pricing",
            description: "Free plan and one-time passes from ₹299.",
          },
        ]}
      />

      <CtaBanner />
    </div>
  )
}
