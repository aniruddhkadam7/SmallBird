import Image from "next/image"
import Link from "next/link"
import { Mail } from "lucide-react"
import logo from "@/assets/smallbird-logo.png"

const columns = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "How it works", href: "/#product-demo" },
      { label: "Pricing", href: "/pricing" },
      { label: "Download for Windows", href: "/download" },
    ],
  },
  {
    title: "Solutions",
    links: [
      { label: "AI Interview Assistant", href: "/ai-interview-assistant" },
      { label: "AI Interview Copilot", href: "/ai-interview-copilot" },
      { label: "AI Coding Interview Assistant", href: "/ai-coding-interview-assistant" },
      { label: "AI Meeting Assistant", href: "/ai-meeting-assistant" },
      { label: "Real-Time AI", href: "/features/real-time-ai" },
    ],
  },
  {
    title: "Compare",
    links: [
      { label: "AI Interview Tools", href: "/ai-interview-tools" },
      { label: "Interview Copilot", href: "/interview-copilot" },
      { label: "Best AI Interview Assistant", href: "/best-ai-interview-assistant" },
      { label: "Best Coding Interview Tools", href: "/best-coding-interview-tools" },
      { label: "Smallbird Alternatives", href: "/smallbird-alternatives" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Privacy by design", href: "/#privacy" },
      { label: "Security", href: "/#security" },
      { label: "Dashboard", href: "/dashboard" },
    ],
  },
]

export function Footer() {
  return (
    <footer className="border-t border-border bg-neutral-950 px-4 py-10 text-neutral-300 sm:py-14">
      <div className="mx-auto max-w-7xl">
        {/* Phones: brand on its own row, then the link columns two-up. */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:gap-8 lg:grid-cols-5">
          <div className="col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2">
              <Image src={logo} alt="" className="h-7 w-auto" />
              <span
                className="text-xl font-bold tracking-tight text-white"
                style={{ fontFamily: "var(--font-playfair-display)" }}
              >
                Smallbird
              </span>
            </div>
            <p className="mt-2 max-w-xs text-sm text-neutral-400 sm:mt-3">
              AI assistance for important conversations.
            </p>
            <a
              href="mailto:support@smallbird.in"
              className="mt-3 inline-flex items-center gap-1.5 text-sm sm:mt-4 text-neutral-400 transition-colors hover:text-white"
            >
              <Mail className="h-3.5 w-3.5" />
              support@smallbird.in
            </a>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <h3 className="text-sm font-semibold text-white">{col.title}</h3>
              <ul className="mt-3 space-y-2.5 sm:mt-4 sm:space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="inline-block text-[13px] leading-snug text-neutral-400 transition-colors hover:text-white sm:text-sm"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-col gap-1.5 border-t border-white/10 pt-5 text-xs text-neutral-500 sm:mt-12 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:pt-6 sm:text-sm">
          <span>© {new Date().getFullYear()} Smallbird. All rights reserved. SmallBird™ is a trademark of Smallbird.</span>
          <span>Made in India 🇮🇳</span>
        </div>
      </div>
    </footer>
  )
}
