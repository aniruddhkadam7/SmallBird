import type { Metadata } from "next"
import { Check, X } from "lucide-react"
import { PageHeader } from "@/components/blocks/page-header"
import { FaqSection } from "@/components/blocks/faq-section"
import { RelatedPages } from "@/components/blocks/related-pages"
import { CtaBanner } from "@/components/blocks/cta-banner"

export const metadata: Metadata = {
  title: "How to Choose the Best AI Interview Assistant for You",
  description:
    "There's no single \"best\" AI interview assistant — the right one depends on your interview type, platform, and budget. A practical checklist, plus an honest look at where Smallbird fits.",
  alternates: { canonical: "/best-ai-interview-assistant" },
}

const criteria = [
  {
    question: "Does it work live, during the interview?",
    answer: "Smallbird: yes",
    good: true,
    detail: "Real-time transcription and suggestions while the conversation happens, not pre-written scripts.",
  },
  {
    question: "Is it grounded in your actual CV and the job description?",
    answer: "Smallbird: yes",
    good: true,
    detail: "Suggestions are shaped by the context you load in, not generic advice.",
  },
  {
    question: "Is it invisible if you share your screen?",
    answer: "Smallbird: yes",
    good: true,
    detail: "The overlay is a separate window from your call — it's never part of what's shared.",
  },
  {
    question: "Does it work across Zoom, Meet, and Teams?",
    answer: "Smallbird: yes",
    good: true,
    detail: "Runs as an overlay on top of any call software rather than a platform-specific plugin.",
  },
  {
    question: "Does it read your screen or code editor for live coding help?",
    answer: "Smallbird: no",
    good: false,
    detail:
      "Smallbird works from audio only. If you specifically need a tool that reads your code editor during a live coding round, that's a different category — see our coding interview tools guide.",
  },
  {
    question: "Is it available on macOS?",
    answer: "Smallbird: yes",
    good: true,
    detail: "Runs on Mac (macOS 14.6 or later, Apple Silicon and Intel) as well as Windows 10/11.",
  },
  {
    question: "Does it have a free plan and India-friendly pricing?",
    answer: "Smallbird: yes",
    good: true,
    detail: "10 minutes/month free, INR pricing, and UPI/PhonePe/Paytm/GPay support via Razorpay.",
  },
]

const faqs = [
  {
    question: "Is Smallbird the best AI interview assistant?",
    answer:
      "We don't claim that, and you shouldn't take any vendor's word for it without checking against your own needs. What we can tell you honestly: Smallbird is real-time, audio-based, grounded in your CV and job description, invisible on screen share, and priced with a free tier for the Indian market. Whether that makes it the right fit depends on what you're evaluating for — the checklist above is meant to help you decide, not just for Smallbird.",
  },
  {
    question: "What should I check before trusting a \"best AI tool\" ranking online?",
    answer:
      "Whether the ranking is written or sponsored by one of the tools it ranks, whether pricing and features are dated, and whether claims (like being invisible during screen share, or reading code editors) are actually demonstrated rather than just asserted.",
  },
  {
    question: "Does Smallbird work for non-technical interviews?",
    answer:
      "Yes — Smallbird is audio-based and grounded in your CV and the job description regardless of interview type, so it applies to behavioral and general interviews as well as technical ones.",
  },
]

export default function BestAiInterviewAssistantPage() {
  return (
    <div className="pb-8">
      <PageHeader
        eyebrow="Buyer's guide"
        title="How to choose the best AI interview assistant — for your situation"
        description={`There isn't one objectively "best" tool. There's a best fit for your interview type, the platforms you use, and your budget. Here's a checklist to evaluate any AI interview assistant, applied honestly to Smallbird.`}
      />

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">A checklist — and where Smallbird stands</h2>
        <div className="mt-6 space-y-4">
          {criteria.map((item) => (
            <div key={item.question} className="flex gap-3 rounded-2xl border border-border p-5">
              {item.good ? (
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-foreground" aria-hidden="true" />
              ) : (
                <X className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <div>
                <p className="font-medium text-foreground">{item.question}</p>
                <p className="text-sm font-medium text-muted-foreground">{item.answer}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <FaqSection items={faqs} />

      <RelatedPages
        links={[
          {
            href: "/ai-interview-assistant",
            label: "AI Interview Assistant",
            description: "The full detail on how Smallbird works.",
          },
          {
            href: "/best-coding-interview-tools",
            label: "Best Coding Interview Tools",
            description: "The same checklist approach, for technical coding rounds.",
          },
          {
            href: "/smallbird-alternatives",
            label: "Smallbird Alternatives",
            description: "Other tools in this space, compared honestly.",
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
