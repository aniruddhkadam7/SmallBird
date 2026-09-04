import type { Metadata } from "next"
import { PageHeader } from "@/components/blocks/page-header"
import { FaqSection } from "@/components/blocks/faq-section"
import { RelatedPages } from "@/components/blocks/related-pages"
import { CtaBanner } from "@/components/blocks/cta-banner"

export const metadata: Metadata = {
  title: "AI Interview Tools: Categories and How to Choose",
  description:
    "A breakdown of the different kinds of AI interview tools — prep tools, mock-interview practice, and real-time copilots — with what to look for in each and where Smallbird fits.",
  alternates: { canonical: "/ai-interview-tools" },
}

const categories = [
  {
    title: "Prep and question-bank tools",
    body: "Used before an interview. Generate likely questions from a job description, or let you rehearse answers against a bank of common questions. Useful for research and rehearsal; they don't help during the interview itself.",
  },
  {
    title: "Mock-interview practice tools",
    body: "Simulate an interview with an AI interviewer and give you feedback afterward — on pacing, filler words, or answer structure. Good for building confidence and identifying habits, used entirely before the real interview.",
  },
  {
    title: "Real-time interview copilots",
    body: "Run during the actual interview. They listen to the live conversation and surface a relevant, context-aware suggestion as a question comes in. Smallbird is in this category — see how it works.",
  },
  {
    title: "Screen/code-reading assistants",
    body: "A subset built specifically for live coding rounds, which capture your screen or code editor to suggest code or algorithm hints directly. This is a distinct capability from listening to spoken conversation — Smallbird doesn't do this; it works from audio only.",
  },
]

const checklist = [
  {
    title: "Does it help before, during, or after the interview?",
    body: "Prep tools and mock-interview practice are pre-interview. Copilots like Smallbird work live, during the conversation.",
  },
  {
    title: "What does it actually listen to or read?",
    body: "Some tools work from audio (the conversation). Others additionally capture your screen or code editor. Know which one you're evaluating — they solve different problems.",
  },
  {
    title: "Is it visible to the interviewer?",
    body: "If it runs during a video call, check whether it's hidden from screen share. Smallbird's overlay is a separate window, invisible even if you share your screen.",
  },
  {
    title: "Which platforms does it support?",
    body: "Desktop app vs. browser extension changes how it behaves across Zoom, Google Meet, Microsoft Teams, and other call software.",
  },
  {
    title: "What does it cost, and in what currency?",
    body: "Subscription vs. one-time pass changes the math depending on how often you're interviewing. If you're in India, check whether pricing is in INR and whether UPI or local wallets are supported — Smallbird's plans are priced in INR with UPI, Google Pay, PhonePe, Paytm, and card support via Razorpay.",
  },
]

const faqs = [
  {
    question: "What's the difference between an AI interview tool and an AI interview copilot?",
    answer:
      "\"AI interview tools\" is the broader category — it includes prep tools, mock-interview practice, and real-time copilots. \"Interview copilot\" specifically refers to tools that assist live, during the actual interview.",
  },
  {
    question: "Do all AI interview tools read your screen?",
    answer:
      "No. Some are audio-only and work from the spoken conversation, like Smallbird. Others specifically capture your screen or code editor for live coding assistance — a different capability aimed at technical coding rounds.",
  },
  {
    question: "Is there one tool that's best for everyone?",
    answer:
      "Not really — it depends on your interview type (behavioral vs. coding), which platforms you use, whether you need screen-level code help or conversational support, and your budget. The checklist above is meant to help you evaluate any tool, including Smallbird, against your own needs.",
  },
  {
    question: "Where does Smallbird fit in?",
    answer:
      "Smallbird is a real-time interview copilot: audio-based, grounded in your CV and job description, invisible on screen share, and priced for the Indian market with a free plan to start.",
  },
]

export default function AiInterviewToolsPage() {
  return (
    <div className="pb-8">
      <PageHeader
        eyebrow="AI Interview Tools"
        title="AI interview tools, by category — and how to pick one"
        description={`"AI interview tools" covers a few genuinely different kinds of product. Here's how they differ, what to check before choosing one, and where Smallbird fits.`}
      />

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">The main categories</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {categories.map((cat) => (
            <div key={cat.title} className="rounded-2xl border border-border p-5">
              <h3 className="font-medium text-foreground">{cat.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{cat.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">What to check before choosing one</h2>
        <div className="mt-6 space-y-5">
          {checklist.map((item) => (
            <div key={item.title}>
              <h3 className="font-medium text-foreground">{item.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
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
            description: "How Smallbird works during a live interview.",
          },
          {
            href: "/interview-copilot",
            label: "Interview Copilot",
            description: "What an interview copilot is and how to evaluate one.",
          },
          {
            href: "/best-coding-interview-tools",
            label: "Best Coding Interview Tools",
            description: "How to evaluate tools built specifically for technical rounds.",
          },
          {
            href: "/smallbird-alternatives",
            label: "Smallbird Alternatives",
            description: "How Smallbird compares to other tools in this space.",
          },
        ]}
      />

      <CtaBanner />
    </div>
  )
}
