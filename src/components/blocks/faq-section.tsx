// Renders visibly as <details>/<summary> (zero client JS) AND emits matching
// FAQPage JSON-LD — Google requires the structured data to match what's
// actually visible on the page, so the two are built from one array here
// rather than kept in sync by hand in two places.
export type FaqItem = { question: string; answer: string }

export function FaqSection({ items }: { items: FaqItem[] }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  }

  return (
    <section className="mx-auto mt-16 max-w-3xl px-4">
      <h2 className="text-2xl font-semibold tracking-tight">Frequently asked questions</h2>
      <div className="mt-6 divide-y divide-border rounded-2xl border border-border">
        {items.map((item) => (
          <details key={item.question} className="group p-5 open:pb-5">
            <summary className="cursor-pointer list-none font-medium text-foreground marker:content-none">
              {item.question}
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">{item.answer}</p>
          </details>
        ))}
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </section>
  )
}
