import type { Metadata } from "next"
import { PageHeader } from "@/components/blocks/page-header"
import { Pricing } from "@/components/sections/pricing"
import { FaqSection } from "@/components/blocks/faq-section"
import { RelatedPages } from "@/components/blocks/related-pages"

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Smallbird pricing: a free plan with 10 minutes a month, and one-time passes from ₹299 for 60 minutes up to ₹999 for 240 minutes. No subscriptions.",
  alternates: { canonical: "/pricing" },
}

const faqs = [
  {
    question: "Is there a free plan?",
    answer:
      "Yes — the Free plan includes 10 minutes a month of Interview Mode with no card required, so you can try Smallbird before paying for anything.",
  },
  {
    question: "What's the difference between the passes?",
    answer:
      "All three are one-time purchases, valid until used — there are no subscriptions. Starter Pass is ₹299 for 60 minutes, Pro Pass is ₹559 for 120 minutes, and Pro+ Pass is ₹999 for 240 minutes. Bigger passes cost less per minute (₹4.98, ₹4.66 and ₹4.16).",
  },
  {
    question: "How is usage measured?",
    answer:
      "In minutes of Interview Mode — the time Smallbird is actively listening and assisting during a live session.",
  },
  {
    question: "What payment methods are supported?",
    answer:
      "Cards (Visa, Mastercard, Amex), UPI, and popular Indian wallets and apps including Google Pay, PhonePe, Paytm, and CRED, through Razorpay.",
  },
]

export default function PricingPage() {
  return (
    <div className="pb-8">
      <PageHeader
        eyebrow="Pricing"
        title="Simple, transparent pricing"
        description="Priced for India. Start free, then pick a one-time pass sized to how much you're interviewing."
      />

      <Pricing />

      <FaqSection items={faqs} />

      <RelatedPages
        links={[
          {
            href: "/download",
            label: "Download",
            description: "Get started free on Windows.",
          },
          {
            href: "/ai-interview-assistant",
            label: "AI Interview Assistant",
            description: "See how Smallbird works during an interview.",
          },
          {
            href: "/smallbird-alternatives",
            label: "Smallbird Alternatives",
            description: "How Smallbird's pricing compares to other tools.",
          },
        ]}
      />
    </div>
  )
}
