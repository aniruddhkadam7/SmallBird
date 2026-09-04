import type { Metadata } from "next"
import { PageHeader } from "@/components/blocks/page-header"
import { ComparisonTable } from "@/components/blocks/comparison-table"
import { FaqSection } from "@/components/blocks/faq-section"
import { RelatedPages } from "@/components/blocks/related-pages"
import { CtaBanner } from "@/components/blocks/cta-banner"

export const metadata: Metadata = {
  title: "Interview Copilot: What It Is and How to Choose One",
  description:
    "An interview copilot listens during your live interview and helps you respond. Here's what defines the category, how copilots differ from each other, and how Smallbird fits.",
  alternates: { canonical: "/interview-copilot" },
}

const faqs = [
  {
    question: "What is an interview copilot, exactly?",
    answer:
      "Software that runs during a live interview — not before it — listening to the conversation and surfacing a relevant, context-aware suggestion as questions come up. The \"copilot\" framing means it assists rather than answers for you.",
  },
  {
    question: "How does a copilot differ from an autopilot-style tool?",
    answer:
      "A copilot surfaces a starting point or relevant angle and leaves the actual answer, in your own words, to you. Tools framed as fully automated would try to generate a complete answer for you to read verbatim — a different (and riskier, since it can sound scripted) approach.",
  },
  {
    question: "Do interview copilots see my screen?",
    answer:
      "It varies by tool. Some work purely from audio, like Smallbird. Others, especially ones built for live coding rounds, also capture your screen or code editor. Check which one you're looking at — see our coding interview tools guide for that distinction.",
  },
  {
    question: "Can the interviewer tell I'm using one?",
    answer:
      "That depends entirely on the tool's design. Smallbird's overlay is a separate window from your call, invisible even during screen share.",
  },
]

export default function InterviewCopilotPage() {
  return (
    <div className="pb-8">
      <PageHeader
        eyebrow="Interview Copilot"
        title="What an interview copilot actually is"
        description={`"Interview copilot" describes a specific kind of tool: one that works live, during the interview, rather than before it. Here's what defines the category and what to look for.`}
      />

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">The defining traits</h2>
        <p className="mt-4 text-muted-foreground">
          Three things tend to separate a genuine interview copilot from a prep tool: it runs during the
          conversation rather than before it, it&apos;s grounded in context you provide (a CV, a job
          description) rather than generic question banks, and it surfaces suggestions live rather than
          requiring you to look something up mid-interview.
        </p>
      </section>

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">Copilot vs. autopilot</h2>
        <ComparisonTable
          columns={["Copilot model", "Autopilot-style model"]}
          rows={[
            { label: "What it produces", values: ["A relevant suggestion or angle", "A full scripted answer"] },
            { label: "Who says the actual words", values: ["You, in your own voice", "Whatever the tool wrote"] },
            { label: "Risk of sounding scripted", values: ["Lower", "Higher"] },
          ]}
          footnote="Smallbird follows the copilot model: it surfaces a relevant point grounded in your CV and the job description, and you decide how to phrase it."
        />
      </section>

      <FaqSection items={faqs} />

      <RelatedPages
        links={[
          {
            href: "/ai-interview-copilot",
            label: "Smallbird: AI Interview Copilot",
            description: "How Smallbird applies the copilot model in practice.",
          },
          {
            href: "/ai-interview-tools",
            label: "AI Interview Tools",
            description: "The broader landscape of AI interview tool categories.",
          },
          {
            href: "/smallbird-alternatives",
            label: "Smallbird Alternatives",
            description: "How Smallbird compares to other interview copilots.",
          },
          {
            href: "/best-ai-interview-assistant",
            label: "Best AI Interview Assistant",
            description: "A checklist for evaluating any interview assistant, including Smallbird.",
          },
        ]}
      />

      <CtaBanner />
    </div>
  )
}
