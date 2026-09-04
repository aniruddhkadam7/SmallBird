import { siteName, siteUrl } from "@/lib/site"

export function OrganizationJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: siteName,
    url: siteUrl,
    logo: `${siteUrl}/smallbird-logo.png`,
    email: "support@smallbird.in",
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

export function SoftwareApplicationJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: siteName,
    url: siteUrl,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Windows, macOS",
    description:
      "Smallbird gives you real-time AI assistance during interviews — with context from your CV and the job description.",
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "INR",
      lowPrice: "0",
      highPrice: "799",
      offerCount: "4",
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}
