import type { Metadata } from "next"
import { PageHeader } from "@/components/blocks/page-header"
import { ComparisonTable } from "@/components/blocks/comparison-table"
import { FaqSection } from "@/components/blocks/faq-section"
import { RelatedPages } from "@/components/blocks/related-pages"
import { CtaBanner } from "@/components/blocks/cta-banner"

export const metadata: Metadata = {
  title: "Smallbird Alternatives: How It Compares",
  description:
    "An honest comparison of Smallbird against other AI interview copilots — what each focuses on, platform support, screen/code reading, and pricing model.",
  alternates: { canonical: "/smallbird-alternatives" },
}

const faqs = [
  {
    question: "Is Smallbird better than these alternatives?",
    answer:
      "It depends on what you need. Smallbird's advantages are specific and verifiable: it's audio-only (nothing captures your screen or code), it's invisible on screen share, it's priced in INR with UPI and local wallet support in India (USD by card elsewhere), and it has a genuinely free tier. If you specifically need a tool that reads your code editor live, a code-reading tool from the table below may fit better — that's a real trade-off, not a reason to call one \"better\" overall.",
  },
  {
    question: "Where does this comparison information come from?",
    answer:
      "From how each company publicly describes its own product. We haven't independently tested every tool listed, and pricing/features change — check each vendor's own site for current details before deciding.",
  },
  {
    question: "Why doesn't Smallbird read the screen or code editor like some alternatives?",
    answer:
      "It's a deliberate scope decision, not a missing feature we're working around: Smallbird is built around the conversational side of interviews. See our coding interview tools guide for the trade-offs between the two approaches.",
  },
  {
    question: "Does Smallbird work outside India?",
    answer:
      "Yes. The app and overlay work anywhere. Outside India, passes are priced in US dollars ($9, $15 and $25) and paid by card; in India they're priced in rupees with UPI, PhonePe, Paytm, Google Pay and cards, all via Razorpay.",
  },
]

export default function SmallbirdAlternativesPage() {
  return (
    <div className="pb-8">
      <PageHeader
        eyebrow="Comparison"
        title="Smallbird alternatives, compared honestly"
        description="A look at how Smallbird differs from other AI interview copilots on the market — by capability and platform, not by unverified rankings."
      />

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">At a glance</h2>
        <ComparisonTable
          columns={["Smallbird", "Final Round AI", "LockedIn AI", "Sensei AI"]}
          rows={[
            { label: "Focus", values: ["Live conversation, audio-based", "Prep + live copilot, incl. coding", "Live coding rounds", "Live copilot, incl. coding mode"] },
            { label: "Reads screen/code editor", values: ["No", "Yes (coding mode)", "Yes (coding mode)", "Coding-specific mode"] },
            { label: "Platform", values: ["Windows and Mac desktop app", "Desktop app", "Browser/desktop", "Browser-based"] },
            { label: "Invisible on screen share", values: ["Yes", "Stealth mode available", "Stealth mode available", "Not confirmed"] },
            { label: "Free plan", values: ["Yes — 10 min/month", "Yes, limited", "Yes, limited", "Yes, limited"] },
            { label: "Pricing model", values: ["INR in India, USD elsewhere; one-time passes", "USD, monthly/annual subscription", "USD, monthly subscription or credits", "USD, monthly subscription"] },
            { label: "India-specific payment support", values: ["UPI, PhonePe, Paytm, Google Pay", "Not confirmed", "Not confirmed", "Not confirmed"] },
          ]}
          footnote="Information on third-party tools reflects how each company publicly describes its own product as of September 2026 — we have not independently tested them, and pricing and features change. Verify current details on each vendor's own site. Smallbird's row is drawn from our own product and pricing pages."
        />
      </section>

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">What actually makes Smallbird different</h2>
        <ul className="mt-4 space-y-3 text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Audio-only by design —</span>{" "}
            nothing about Smallbird captures your screen or code editor, which simplifies the privacy
            story compared to tools that do.
          </li>
          <li>
            <span className="font-medium text-foreground">Local pricing —</span>{" "}
            INR with UPI, PhonePe, Paytm, and Google Pay in India, and USD by card everywhere else, as one-time passes rather than a subscription.
          </li>
          <li>
            <span className="font-medium text-foreground">A real free tier —</span>{" "}
            10 minutes a month, no card required, to try it before paying anything.
          </li>
        </ul>
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
            description: "The screen-reading vs. conversation-based trade-off, explained.",
          },
          {
            href: "/interview-copilot",
            label: "Interview Copilot",
            description: "What defines the category Smallbird competes in.",
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
