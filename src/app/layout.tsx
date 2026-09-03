import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import "./globals.css";
import { GlassFilter } from "@/components/ui/liquid-glass-button";
import { PurchaseFlowDialog } from "@/components/blocks/purchase-flow-dialog";
import { PurchaseFlowProvider } from "@/lib/purchase-flow";

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
  title: "Smallbird — AI Assistant",
  description:
    "Smallbird gives you real-time AI assistance during interviews — with context from your CV and the job description.",
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
