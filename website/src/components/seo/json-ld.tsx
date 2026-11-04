import { brandAlternateNames, brandProfiles, siteName, siteUrl } from "@/lib/site"
import { WINDOWS_INSTALLER_URL } from "@/lib/download"

// Stable ids let the Organization, WebSite and SoftwareApplication blocks
// reference each other, so Google reads them as one entity (the brand, its
// site and its product) instead of three unrelated things.
const ORG_ID = `${siteUrl}/#organization`
const WEBSITE_ID = `${siteUrl}/#website`
const APP_ID = `${siteUrl}/#software`

function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

export function OrganizationJsonLd() {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "Organization",
        "@id": ORG_ID,
        name: siteName,
        alternateName: brandAlternateNames,
        url: siteUrl,
        logo: {
          "@type": "ImageObject",
          url: `${siteUrl}/smallbird-icon-512.png`,
          width: 512,
          height: 512,
        },
        description:
          "SmallBird AI makes a real-time AI assistant for job interviews and important calls, for Windows and Mac.",
        email: "support@smallbirdai.com",
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          email: "support@smallbirdai.com",
          availableLanguage: ["English", "Hindi"],
        },
        areaServed: "Worldwide",
        foundingLocation: { "@type": "Place", name: "India" },
        ...(brandProfiles.length ? { sameAs: brandProfiles } : {}),
      }}
    />
  )
}

export function WebsiteJsonLd() {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "WebSite",
        "@id": WEBSITE_ID,
        // Google's "site name" in results comes from here.
        name: siteName,
        alternateName: brandAlternateNames,
        url: siteUrl,
        inLanguage: "en",
        publisher: { "@id": ORG_ID },
      }}
    />
  )
}

export function SoftwareApplicationJsonLd() {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "@id": APP_ID,
        name: siteName,
        alternateName: brandAlternateNames,
        url: siteUrl,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "AI interview assistant",
        operatingSystem: "Windows, macOS",
        downloadUrl: `${siteUrl}/download`,
        installUrl: WINDOWS_INSTALLER_URL,
        image: `${siteUrl}/opengraph-image`,
        publisher: { "@id": ORG_ID },
        description:
          "SmallBird AI gives you real-time AI assistance during interviews — with context from your CV and the job description.",
        offers: [
          { "@type": "AggregateOffer", priceCurrency: "INR", lowPrice: "0", highPrice: "999", offerCount: "4" },
          { "@type": "AggregateOffer", priceCurrency: "USD", lowPrice: "0", highPrice: "25", offerCount: "4" },
        ],
      }}
    />
  )
}

// Breadcrumb trail (Home > page) shown in place of the bare URL in results.
export function BreadcrumbJsonLd({ name, path }: { name: string; path: string }) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: siteName, item: siteUrl },
          { "@type": "ListItem", position: 2, name, item: `${siteUrl}${path}` },
        ],
      }}
    />
  )
}
