import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import "./globals.css";
import { GlassFilter } from "@/components/ui/liquid-glass-button";
import { PurchaseFlowDialog } from "@/components/blocks/purchase-flow-dialog";
import { PurchaseFlowProvider } from "@/lib/purchase-flow";
import { siteName, siteUrl } from "@/lib/site";
import { OrganizationJsonLd } from "@/components/seo/json-ld";

const title = "Smallbird — Real-time AI Assistant for Interviews";
const description =
  "Smallbird gives you real-time AI assistance during interviews — with context from your CV and the job description. Free to download for Windows and macOS.";

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
    "real-time interview help",
    "AI interview copilot",
    "interview AI tool",
    "AI assistant for job interviews",
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
  icons: {
    icon: "/smallbird-logo.png",
    shortcut: "/smallbird-logo.png",
    apple: "/smallbird-logo.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="light"
      style={{ colorScheme: "light" }}
      className={`${geistSans.variable} ${geistMono.variable} ${playfairDisplay.variable} antialiased`}
    >
      <body>
        <OrganizationJsonLd />
        <PurchaseFlowProvider>
          <div id="top" className="relative">
            <GlassFilter />
            {children}
            <PurchaseFlowDialog />
          </div>
        </PurchaseFlowProvider>
      </body>
    </html>
  );
}
