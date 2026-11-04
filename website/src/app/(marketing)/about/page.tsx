import type { Metadata } from "next"
import { PageHeader } from "@/components/blocks/page-header"
import { FaqSection } from "@/components/blocks/faq-section"
import { RelatedPages } from "@/components/blocks/related-pages"
import { BreadcrumbJsonLd } from "@/components/seo/json-ld"

// The brand's entity page: what SmallBird AI is, every spelling of the name,
// and which "smallbird" this is (the word also names a Don't Starve creature
// and an unrelated bird-ID app), so searches for the name resolve here.
export const metadata: Metadata = {
  title: { absolute: "About SmallBird AI (SmallBird) — Real-Time AI Interview Assistant" },
  description:
    "SmallBird AI (also written SmallBird or Small Bird AI) is a real-time AI assistant for job interviews and important calls, for Windows and Mac, made in India. Official site: smallbirdai.com.",
  alternates: { canonical: "/about" },
}

const faqs = [
  {
    question: "What is SmallBird AI?",
    answer:
      "SmallBird AI is a desktop app for Windows and Mac that listens to a live interview or call and suggests what to say in real time, grounded in your CV and the job description. It stays invisible when you share your screen.",
  },
  {
    question: "Is it SmallBird, Smallbird or Small Bird AI?",
    answer:
      "All of them mean the same product. The official name is SmallBird AI, and the official website is smallbirdai.com. Our earlier address, smallbird.in, now redirects there.",
  },
  {
    question: "Is SmallBird AI related to the Smallbird in Don't Starve or the SmallBird bird-identification app?",
    answer:
      "No. SmallBird AI is an AI interview and meeting assistant and has no connection to the Smallbird creature in the game Don't Starve or to the SmallBird bird-identification app on the App Store.",
  },
  {
    question: "Where is SmallBird AI made?",
    answer: "SmallBird AI is built in India and used by job seekers in India and around the world.",
  },
  {
    question: "How do I contact SmallBird AI?",
    answer: "Email support@smallbirdai.com — a real person replies.",
  },
]

export default function AboutPage() {
  return (
    <div className="pb-8">
      <BreadcrumbJsonLd name="About" path="/about" />
      <PageHeader
        eyebrow="About"
        title="About SmallBird AI"
        description="SmallBird AI is a real-time AI assistant for job interviews and important calls. It listens as the conversation happens and helps you answer well — on Windows and Mac."
      />

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">What SmallBird AI does</h2>
        <ul className="mt-4 space-y-3 text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Real-time interview help —</span> it hears the
            question and suggests an answer while you&apos;re still in the conversation.
          </li>
          <li>
            <span className="font-medium text-foreground">Grounded in you —</span> answers use your CV and the
            job description, so they sound like your experience, not a generic script.
          </li>
          <li>
            <span className="font-medium text-foreground">Invisible on screen share —</span> the assistant
            window doesn&apos;t show up when you share your screen.
          </li>
          <li>
            <span className="font-medium text-foreground">More than interviews —</span> the same help works in
            meetings and important calls, plus a free AI resume builder and a phone companion.
          </li>
          <li>
            <span className="font-medium text-foreground">Fair pricing —</span> a free plan with 10 minutes a
            month, then one-time passes with no subscription.
          </li>
        </ul>
      </section>

      <section className="mx-auto mt-16 max-w-3xl px-4">
        <h2 className="text-2xl font-semibold tracking-tight">The name</h2>
        <p className="mt-4 text-muted-foreground">
          The official name is <span className="font-medium text-foreground">SmallBird AI</span>. You may also
          see it written as SmallBird, Smallbird AI or Small Bird AI — it&apos;s the same product. The official
          website is <span className="font-medium text-foreground">smallbirdai.com</span>, and the only official
          downloads are the Windows and Mac installers linked from its download page.
        </p>
      </section>

      <FaqSection items={faqs} />

      <RelatedPages
        links={[
          { href: "/download", label: "Download SmallBird AI", description: "Free for Windows and Mac." },
          { href: "/pricing", label: "Pricing", description: "Free plan and one-time passes." },
          {
            href: "/smallbird-alternatives",
            label: "SmallBird AI Alternatives",
            description: "How SmallBird AI compares to other interview copilots.",
          },
        ]}
      />
    </div>
  )
}
