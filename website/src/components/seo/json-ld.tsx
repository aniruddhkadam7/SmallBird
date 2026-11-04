import { siteName, siteUrl } from "@/lib/site"

export function OrganizationJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: siteName,
    alternateName: ["SmallBird", "Small Bird AI", "smallbirdai"],
    url: siteUrl,
    logo: `${siteUrl}/smallbird-icon-512.png`,
    email: "support@smallbirdai.com",
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

export function WebsiteJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteName,
    alternateName: ["SmallBird", "Small Bird AI", "smallbirdai"],
    url: siteUrl,
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
      "SmallBird AI gives you real-time AI assistance during interviews — with context from your CV and the job description.",
    offers: [
      { "@type": "AggregateOffer", priceCurrency: "INR", lowPrice: "0", highPrice: "999", offerCount: "4" },
      { "@type": "AggregateOffer", priceCurrency: "USD", lowPrice: "0", highPrice: "25", offerCount: "4" },
    ],
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}
