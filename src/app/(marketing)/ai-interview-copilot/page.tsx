import type { Metadata } from "next"
import { PageHeader } from "@/components/blocks/page-header"
import { FaqSection } from "@/components/blocks/faq-section"
import { RelatedPages } from "@/components/blocks/related-pages"
import { CtaBanner } from "@/components/blocks/cta-banner"

export const metadata: Metadata = {
  title: "AI Interview Copilot",
  description:
    "Smallbird is an AI interview copilot, not an autopilot — it surfaces context-aware suggestions live during your interview while you stay in control of what you say.",
  alternates: { canonical: "/ai-interview-copilot" },
}

const faqs = [
  {
    question: "What's the difference between a copilot and an autopilot here?",
    answer:
      "An autopilot would try to answer for you. Smallbird is a copilot: it surfaces a relevant, context-aware suggestion as the question comes in, and you decide what to actually say, in your own words. You stay the one being interviewed.",
  },
  {
    question: "Won't I sound like I'm reading a script?",
    answer:
      "Smallbird surfaces short, relevant points rather than a paragraph to recite verbatim — the goal is to jog what you already know using your CV and the job description as context, not to script your answer word for word.",
  },
  {
    question: "Does it work for behavioral and technical interviews?",
    answer:
      "Yes, for both. The context you load in (CV, job description) shapes what's relevant regardless of interview format. For coding-specific interviews, see how Smallbird handles the verbal side of technical rounds.",
  },
  {
    question: "Is it visible to the interviewer during a video call?",
    answer:
      "No. Smallbird runs as its own overlay window, separate from your call window, and stays invisible even if you share your screen.",
  },
]

export default function AiInterviewCopilotPage() {
  return (
    <div className="pb-8">
      <PageHeader
        eyebrow="AI Interview Copilot"
        title="Your real-time AI interview copilot — not an autopilot"
        description="Smallbird works alongside you during the interview, the way a copilot works alongside a pilot: present, aware of the same context, and ready with a suggestion — while you stay the one flying the conversation."
      />

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">Why &quot;copilot&quot; and not &quot;autopilot&quot;</h2>
        <p className="mt-4 text-muted-foreground">
          An interview isn&apos;t something you want to hand off entirely — you&apos;re the one being evaluated,
          and the answers need to sound like you. Smallbird is built around that: it listens to the
          conversation and surfaces a relevant point grounded in your CV and the job description, but
          it doesn&apos;t try to generate a full scripted answer for you to read aloud. The suggestion is a
          starting point; how you phrase it, and what you add from your own experience, is still yours.
        </p>
      </section>

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">What makes it real-time</h2>
        <p className="mt-4 text-muted-foreground">
          Most interview prep happens before the conversation — mock interviews, question banks,
          rehearsed stories. Smallbird works during it instead. Speech-to-text runs locally on your
          machine as the interview happens, so a suggestion can appear while the question is still
          being asked, not minutes later.
        </p>
      </section>

      <FaqSection items={faqs} />

      <RelatedPages
        links={[
          {
            href: "/ai-interview-assistant",
            label: "AI Interview Assistant",
            description: "The full picture of how Smallbird works during an interview.",
          },
          {
            href: "/ai-coding-interview-assistant",
            label: "AI Coding Interview Assistant",
            description: "Verbal support for technical and coding rounds.",
          },
          {
            href: "/features/real-time-ai",
            label: "Real-Time AI",
            description: "How the live transcription and response pipeline works.",
          },
          {
            href: "/interview-copilot",
            label: "Interview Copilot",
            description: "What defines the category, and how to evaluate any copilot.",
          },
          {
            href: "/smallbird-alternatives",
            label: "Smallbird Alternatives",
            description: "How Smallbird compares to other interview copilots.",
          },
          {
            href: "/pricing",
            label: "Pricing",
            description: "Free plan and one-time passes from ₹299 in India, $9 elsewhere.",
          },
        ]}
      />

      <CtaBanner />
    </div>
  )
}
