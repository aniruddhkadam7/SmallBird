import type { Metadata } from "next"
import { PageHeader } from "@/components/blocks/page-header"
import { FaqSection } from "@/components/blocks/faq-section"
import { RelatedPages } from "@/components/blocks/related-pages"
import { CtaBanner } from "@/components/blocks/cta-banner"

export const metadata: Metadata = {
  title: "AI Meeting Assistant",
  description:
    "Smallbird works as a real-time AI assistant on any video call — Zoom, Google Meet, Microsoft Teams, and more — surfacing context-aware help while the conversation is happening.",
  alternates: { canonical: "/ai-meeting-assistant" },
}

const faqs = [
  {
    question: "Is Smallbird only for job interviews?",
    answer:
      "Smallbird is built and optimized around Interview Mode today, but the underlying mechanism — real-time transcription plus context-grounded suggestions, running as an overlay on top of any call — applies to any conversation where you'd benefit from live support, not only interviews.",
  },
  {
    question: "Which video call platforms does it work with?",
    answer:
      "Smallbird runs as an overlay on your screen rather than a platform-specific plugin, so it works the same way on Zoom, Google Meet, Microsoft Teams, Webex, GoToMeeting, and other video call software — open any of them and it works.",
  },
  {
    question: "Can the other people on the call see it?",
    answer:
      "No. Smallbird's overlay is a separate window from your call. If you share your screen or present, what others see is the normal call — the overlay is never part of what's shared.",
  },
  {
    question: "What context can it use outside of an interview?",
    answer:
      "Today, Smallbird is set up around CV and job-description context for interviews specifically. For other calls, the same real-time listening and overlay apply, though the context-loading workflow is built with interview prep in mind.",
  },
]

export default function AiMeetingAssistantPage() {
  return (
    <div className="pb-8">
      <PageHeader
        eyebrow="AI Meeting Assistant"
        title="Real-time AI assistance for any important conversation"
        description="Smallbird listens as a call happens and surfaces relevant, context-aware help live — built first for interviews, and useful on any video call where the conversation matters."
      />

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">Works on the calls you already use</h2>
        <p className="mt-4 text-muted-foreground">
          Smallbird doesn&apos;t integrate with any one platform specifically — it runs as an overlay on
          your screen, on top of whatever call software is already open. That means Zoom, Google Meet,
          Microsoft Teams, Webex, and GoToMeeting all work the same way, with nothing to install inside
          the call itself.
        </p>
      </section>

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">Built for interviews, useful beyond them</h2>
        <p className="mt-4 text-muted-foreground">
          Smallbird&apos;s current release is centered on Interview Mode: real-time transcription, CV and
          job-description context, and live suggestions while an interview is happening. The same core
          mechanism — listening live and staying invisible on screen share — is what makes it relevant
          to any high-stakes, real-time conversation, not only interviews.
        </p>
      </section>

      <FaqSection items={faqs} />

      <RelatedPages
        links={[
          {
            href: "/ai-interview-assistant",
            label: "AI Interview Assistant",
            description: "Smallbird's primary use case, in full detail.",
          },
          {
            href: "/features/real-time-ai",
            label: "Real-Time AI",
            description: "How the live transcription and response pipeline works.",
          },
          {
            href: "/ai-interview-copilot",
            label: "AI Interview Copilot",
            description: "Why Smallbird surfaces suggestions instead of scripted answers.",
          },
          {
            href: "/ai-interview-tools",
            label: "AI Interview Tools",
            description: "The broader landscape of AI interview and meeting tool categories.",
          },
          {
            href: "/pricing",
            label: "Pricing",
            description: "Free plan, one-time passes, and monthly plans.",
          },
        ]}
      />

      <CtaBanner />
    </div>
  )
}
