import type { Metadata } from "next"
import { EyeOff } from "lucide-react"
import { PageHeader } from "@/components/blocks/page-header"
import { ComparisonTable } from "@/components/blocks/comparison-table"
import { FaqSection } from "@/components/blocks/faq-section"
import { RelatedPages } from "@/components/blocks/related-pages"
import { CtaBanner } from "@/components/blocks/cta-banner"

export const metadata: Metadata = {
  title: "Best Coding Interview Tools: Two Categories, and How to Pick",
  description:
    "Tools for coding interviews split into two genuinely different categories — code/screen readers and verbal-conversation assistants. Here's the difference, and where SmallBird AI fits.",
  alternates: { canonical: "/best-coding-interview-tools" },
}

const faqs = [
  {
    question: "What's the difference between a code-reading tool and SmallBird AI for coding interviews?",
    answer:
      "A code-reading tool captures your screen or IDE to suggest code, algorithms, or fixes directly. SmallBird AI doesn't do this — it listens to the spoken conversation around the problem (explaining your approach, defending trade-offs, discussing complexity) and grounds its suggestions in your CV and the job description.",
  },
  {
    question: "Which one should I use?",
    answer:
      "If you specifically need help writing or debugging code live, you're looking for a screen/code-reading category tool. If you want help with the verbal, reasoning side of a coding interview — a large part of most real coding rounds — SmallBird AI's approach fits that instead. The two aren't mutually exclusive categories to consider.",
  },
  {
    question: "Are code-reading tools riskier to use?",
    answer:
      "Screen/code-capture during a live interview raises platform-policy and detectability questions that vary by employer and interview platform. We're not the right source to advise on that trade-off for you — it's worth evaluating for your specific situation. SmallBird AI avoids this entirely by never capturing your screen or code.",
  },
  {
    question: "Does SmallBird AI help with system design interviews?",
    answer:
      "Yes — system design rounds are largely verbal discussion with little or no code, which is exactly where SmallBird AI's audio-based, live assistance applies most directly.",
  },
]

export default function BestCodingInterviewToolsPage() {
  return (
    <div className="pb-8">
      <PageHeader
        eyebrow="Buyer's guide"
        title="The best coding interview tools split into two categories"
        description="Before comparing specific tools, it helps to know that 'coding interview tool' actually covers two different jobs. Here's the distinction, and where SmallBird AI sits."
      />

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">Two different jobs, one search term</h2>
        <ComparisonTable
          columns={["Screen/code-reading tools", "SmallBird AI"]}
          rows={[
            { label: "Reads your screen or code editor", values: ["Yes", "No"] },
            { label: "Listens to the spoken conversation", values: ["Varies by tool", "Yes"] },
            { label: "Grounded in your CV / job description", values: ["Varies by tool", "Yes"] },
            { label: "Best for", values: ["Live code/algorithm suggestions", "Explaining approach, trade-offs, and reasoning out loud"] },
          ]}
          footnote="Capabilities of third-party tools vary and change over time — check each vendor's own site for current details before deciding."
        />
      </section>

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <div className="flex gap-3 rounded-2xl border border-border bg-foreground/[0.02] p-5">
          <EyeOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <h2 className="font-medium text-foreground">Where SmallBird AI intentionally stops</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              SmallBird AI does not capture your screen, IDE, or code, and won&apos;t suggest code for you to
              type. It&apos;s built around the conversation that happens alongside the coding — explaining
              your approach, defending decisions, and answering follow-ups — not the code itself.
            </p>
          </div>
        </div>
      </section>

      <FaqSection items={faqs} />

      <RelatedPages
        links={[
          {
            href: "/ai-coding-interview-assistant",
            label: "AI Coding Interview Assistant",
            description: "The full detail on how SmallBird AI helps with coding interviews.",
          },
          {
            href: "/ai-interview-tools",
            label: "AI Interview Tools",
            description: "The broader landscape of AI interview tool categories.",
          },
          {
            href: "/smallbird-alternatives",
            label: "SmallBird AI Alternatives",
            description: "Other tools in this space, compared honestly.",
          },
          {
            href: "/best-ai-interview-assistant",
            label: "Best AI Interview Assistant",
            description: "The same checklist approach, for general interviews.",
          },
        ]}
      />

      <CtaBanner />
    </div>
  )
}
