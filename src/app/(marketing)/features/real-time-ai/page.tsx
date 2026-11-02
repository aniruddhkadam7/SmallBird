import type { Metadata } from "next"
import { PageHeader } from "@/components/blocks/page-header"
import { FaqSection } from "@/components/blocks/faq-section"
import { RelatedPages } from "@/components/blocks/related-pages"
import { CtaBanner } from "@/components/blocks/cta-banner"

export const metadata: Metadata = {
  title: "Real-Time AI",
  description:
    "How Smallbird's real-time AI pipeline works: local speech-to-text transcription as the conversation happens, followed by context-aware suggestions grounded in your CV and the job description.",
  alternates: { canonical: "/features/real-time-ai" },
}

const faqs = [
  {
    question: "What makes Smallbird 'real-time'?",
    answer:
      "Speech-to-text transcription runs locally on your machine as the conversation happens, rather than being processed after the call. A relevant suggestion can appear while a question is still being asked.",
  },
  {
    question: "Where does the transcription happen?",
    answer:
      "Locally, on your device. The audio pipeline stays close to home as the conversation is happening, rather than depending on a round trip to a remote server just to turn speech into text.",
  },
  {
    question: "What decides what suggestion Smallbird shows?",
    answer:
      "The live transcript, combined with the context you loaded in ahead of time — your CV and the job description. Suggestions are generated as the conversation unfolds and are grounded in that context rather than being generic.",
  },
  {
    question: "Does real-time mean instant?",
    answer:
      "It means the pipeline is built to respond while the conversation is still happening rather than after it ends. Exact latency depends on your machine and the length of what's being said, but the design goal is to keep pace with a live conversation.",
  },
]

export default function RealTimeAiPage() {
  return (
    <div className="pb-8">
      <PageHeader
        eyebrow="Feature"
        title="Real-time AI: how Smallbird keeps pace with a live conversation"
        description="Two things have to happen fast for assistance to be useful mid-conversation: turning speech into text, and turning that text plus your context into a relevant suggestion. Here's how Smallbird does both."
      />

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">1. Local speech-to-text</h2>
        <p className="mt-4 text-muted-foreground">
          As the conversation happens, Smallbird transcribes it on your machine. Keeping this step
          local — rather than streaming raw audio to a remote server first — keeps the pipeline close
          to the conversation as it unfolds.
        </p>
      </section>

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">2. Context-aware suggestions</h2>
        <p className="mt-4 text-muted-foreground">
          The live transcript is combined with the context you loaded in beforehand — your CV and the
          job description — so what Smallbird surfaces is shaped by your actual background and the
          actual role, not generic advice. Suggestions are generated as the conversation unfolds, not
          precomputed from a static question bank.
        </p>
      </section>

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">3. Stays out of the way</h2>
        <p className="mt-4 text-muted-foreground">
          Smallbird&apos;s overlay is a separate window from your call. It&apos;s built to be quick to glance at
          and dismiss, and it stays invisible even if you share your screen — the interviewer or other
          participants only ever see the call itself.
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
            href: "/ai-meeting-assistant",
            label: "AI Meeting Assistant",
            description: "The same real-time pipeline, useful on any video call.",
          },
          {
            href: "/ai-coding-interview-assistant",
            label: "AI Coding Interview Assistant",
            description: "How this applies to the verbal side of technical interviews.",
          },
          {
            href: "/pricing",
            label: "Pricing",
            description: "Free plan and one-time passes from ₹299.",
            descriptionUsd: "Free plan and one-time passes from $9.",
          },
        ]}
      />

      <CtaBanner />
    </div>
  )
}
