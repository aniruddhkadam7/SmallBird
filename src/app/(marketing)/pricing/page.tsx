import type { Metadata } from "next"
import { PageHeader } from "@/components/blocks/page-header"
import { Pricing } from "@/components/sections/pricing"
import { FaqSection } from "@/components/blocks/faq-section"
import { RelatedPages } from "@/components/blocks/related-pages"

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Smallbird pricing: a free plan with 10 minutes a month, a ₹199 one-time interview pass, and Pro plans from ₹499/month for regular use.",
  alternates: { canonical: "/pricing" },
}

const faqs = [
  {
    question: "Is there a free plan?",
    answer:
      "Yes — the Free plan includes 10 minutes a month of Interview Mode with no card required, so you can try Smallbird before paying for anything.",
  },
  {
    question: "What's the difference between Starter and Pro?",
    answer:
      "Starter is a one-time ₹199 purchase giving you 1 hour of Interview Mode, valid until used — good for a single upcoming interview. Pro and Pro Plus are monthly subscriptions (₹499 and ₹799) with 3 and 6 hours a month respectively, for ongoing job searches.",
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
        description="Priced for India. Start free, then pick a one-time pass or a monthly plan based on how often you're interviewing."
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
        ]}
      />
    </div>
  )
}
