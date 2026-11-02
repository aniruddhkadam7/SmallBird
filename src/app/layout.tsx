import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { Suspense } from "react";
import { AnalyticsTracker } from "@/components/analytics-tracker";
import "./globals.css";
import { GlassFilter } from "@/components/ui/liquid-glass-button";
import { PurchaseFlowDialog } from "@/components/blocks/purchase-flow-dialog";
import { PurchaseFlowProvider } from "@/lib/purchase-flow";
import { siteName, siteUrl } from "@/lib/site";
import { OrganizationJsonLd, WebsiteJsonLd } from "@/components/seo/json-ld";
import { currencyScript } from "@/lib/currency";

const title = "Smallbird — AI Interview & Meeting Assistant";
const description =
  "Smallbird is a real-time AI assistant for interviews and important calls. It listens as the conversation happens, grounds its help in your CV and the job description, and stays invisible even if you share your screen.";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfairDisplay = Playfair_Display({
  variable: "--font-playfair-display",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: "%s — Smallbird",
  },
  description,
  keywords: [
    "Smallbird",
    "AI interview assistant",
    "AI interview copilot",
    "real-time interview assistant",
    "AI coding interview assistant",
    "interview preparation AI",
    "AI meeting assistant",
    "interview copilot",
    "real-time AI assistant",
  ],
  applicationName: siteName,
  authors: [{ name: siteName }],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName,
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  // Favicons come from app/favicon.ico, app/icon.png and app/apple-icon.png
  // (square, multiples of 48px) -- Google Search ignores non-square icons.
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="light"
      style={{ colorScheme: "light" }}
      className={`${geistSans.variable} ${geistMono.variable} ${playfairDisplay.variable} antialiased`}
      // data-currency is added by currencyScript before React hydrates.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: currencyScript }} />
      </head>
      <body>
        <OrganizationJsonLd />
        <WebsiteJsonLd />
        <PurchaseFlowProvider>
          <div id="top" className="relative">
            <GlassFilter />
            {children}
            <PurchaseFlowDialog />
          </div>
        </PurchaseFlowProvider>
        <Analytics />
        <Suspense fallback={null}>
          <AnalyticsTracker />
        </Suspense>
      </body>
    </html>
  );
}
