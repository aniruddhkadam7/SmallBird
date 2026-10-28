import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// The SmallBird wordmark's font -- the same one the website and desktop app use.
const playfair = Playfair_Display({ subsets: ["latin"], weight: "700", variable: "--font-brand" });

export const metadata: Metadata = {
  title: "Smallbird Admin",
  description: "Internal admin console -- authorized staff only.",
  robots: { index: false, follow: false },
  // Added to an iPhone home screen, open full-screen like an app. The status
  // bar draws over the page, so the shell pads for the safe areas.
  appleWebApp: { capable: true, title: "SB Admin", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  // Next only emits the generic mobile-web-app-capable tag; older iOS needs
  // Apple's own name for it to open full-screen.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Stops iOS zooming in when a form field is tapped and leaving the page zoomed.
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1525" },
  ],
};

// Applies the saved theme before paint so there's no flash of the wrong
// theme on load -- runs as an inline script since Next can't know the
// user's localStorage preference during server rendering.
const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var theme = stored === "light" || stored === "dark" ? stored : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    if (theme === "dark") document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = theme;
    // With no saved choice, follow OS theme changes live (the in-app toggle
    // also handles this; this covers pages without it, like /login).
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function (e) {
      try { if (localStorage.getItem("theme")) return; } catch (err) {}
      document.documentElement.classList.toggle("dark", e.matches);
      document.documentElement.style.colorScheme = e.matches ? "dark" : "light";
    });
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
