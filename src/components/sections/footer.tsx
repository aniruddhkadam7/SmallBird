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
    <footer className="border-t border-border bg-neutral-950 px-4 py-14 text-neutral-300">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 sm:grid-cols-2 sm:gap-8 lg:grid-cols-[1.1fr_1fr_1fr_1fr]">
          <div>
            <Image src={logo} alt="Smallbird" className="h-8 w-auto" />
            <p className="mt-3 max-w-xs text-sm text-neutral-400">
              AI assistance for important conversations.
            </p>
            <a
              href="mailto:support@smallbird.in"
              className="mt-4 inline-flex items-center gap-1.5 text-sm text-neutral-400 transition-colors hover:text-white"
            >
              <Mail className="h-3.5 w-3.5" />
              support@smallbird.in
            </a>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <h3 className="text-sm font-semibold text-white">{col.title}</h3>
              <ul className="mt-4 space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-neutral-400 transition-colors hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-white/10 pt-6 text-sm text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
          <span>SmallBird™ is a trademark of Smallbird. © {new Date().getFullYear()} Smallbird. All rights reserved.</span>
          <span>Made in India 🇮🇳</span>
        </div>
      </div>
    </footer>
  )
}
