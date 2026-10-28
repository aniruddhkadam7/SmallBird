import type { Metadata } from "next"
import { FileText, AudioLines, EyeOff, Sparkles } from "lucide-react"
import { PageHeader } from "@/components/blocks/page-header"
import { FaqSection } from "@/components/blocks/faq-section"
import { RelatedPages } from "@/components/blocks/related-pages"
import { CtaBanner } from "@/components/blocks/cta-banner"

export const metadata: Metadata = {
  title: "AI Interview Assistant",
  description:
    "Smallbird is a real-time AI interview assistant: it listens as your interview happens, grounds its help in your CV and the job description, and stays invisible on screen share.",
  alternates: { canonical: "/ai-interview-assistant" },
}

const capabilities = [
  {
    icon: FileText,
    title: "Grounded in your CV and the job description",
    body: "Before the interview, you load in your resume and the job posting. Every response Smallbird surfaces is shaped by that context, not generic advice.",
  },
  {
    icon: AudioLines,
    title: "Local, real-time transcription",
    body: "Speech-to-text runs on your machine as the interview happens, so there's no lag waiting for audio to round-trip to a server before Smallbird can respond.",
  },
  {
    icon: Sparkles,
    title: "Assistance while the question is still being asked",
    body: "Smallbird follows the conversation live and surfaces a relevant response as the question comes in — not a pre-written script you rehearsed the night before.",
  },
  {
    icon: EyeOff,
    title: "Invisible on screen share",
    body: "Smallbird's window is separate from the call itself. If you share your screen, the interviewer sees a normal call — never your overlay.",
  },
]

const faqs = [
  {
    question: "What exactly is an AI interview assistant?",
    answer:
      "It's software that listens to your interview in real time and helps you respond — as distinct from interview-prep tools you use before the interview. Smallbird works during the conversation itself, using context you've given it (your CV, the job description) rather than generic answers.",
  },
  {
    question: "Can the interviewer see Smallbird?",
    answer:
      "No. Smallbird runs as a separate overlay window on your screen, distinct from your video call window. If you share your screen or your camera is on, what's visible to others is a normal call — the overlay isn't part of what gets shared.",
  },
  {
    question: "Does it work on Zoom, Google Meet, and Microsoft Teams?",
    answer:
      "Yes. Smallbird works as an overlay on top of whatever call software you're already using — Zoom, Google Meet, Microsoft Teams, Webex, GoToMeeting, and others — rather than a platform-specific plugin.",
  },
  {
    question: "How much does Smallbird cost?",
    answer:
      "Smallbird has a free plan (10 minutes a month) and one-time passes starting at ₹299 for 60 minutes. See full pricing for details.",
  },
  {
    question: "Is Smallbird available for Mac?",
    answer:
      "Smallbird is currently available for Windows 10 and 11. macOS support is coming soon.",
  },
]

export default function AiInterviewAssistantPage() {
  return (
    <div className="pb-8">
      <PageHeader
        eyebrow="AI Interview Assistant"
        title="An AI interview assistant that listens with you, in real time"
        description="Smallbird is a real-time AI interview assistant. It follows your interview as it happens, understands the context you've given it, and helps you respond well — without ever showing up on a screen share."
      />

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {capabilities.map((cap) => (
            <div key={cap.title} className="rounded-2xl border border-border p-5">
              <cap.icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <h3 className="mt-3 font-medium text-foreground">{cap.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{cap.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">Who it&apos;s for</h2>
        <p className="mt-4 text-muted-foreground">
          Smallbird is built for candidates who want support during the interview itself, not just
          before it. That includes job seekers preparing for technical, behavioral, or general
          interviews, and anyone who freezes up under live questioning despite knowing the material
          cold. It&apos;s grounded in your own CV and the job description, so the assistance stays specific
          to the role you&apos;re actually interviewing for.
        </p>
      </section>

      <FaqSection items={faqs} />

      <RelatedPages
        links={[
          {
            href: "/ai-interview-copilot",
            label: "AI Interview Copilot",
            description: "How the copilot model differs from an autopilot that answers for you.",
          },
          {
            href: "/ai-coding-interview-assistant",
            label: "AI Coding Interview Assistant",
            description: "How Smallbird helps with the verbal side of technical interviews.",
          },
          {
            href: "/ai-meeting-assistant",
            label: "AI Meeting Assistant",
            description: "The same real-time assistance, useful beyond interviews too.",
          },
          {
            href: "/best-ai-interview-assistant",
            label: "Best AI Interview Assistant",
            description: "A checklist for evaluating any interview assistant, including this one.",
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
