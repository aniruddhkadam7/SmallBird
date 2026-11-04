"use client"

import { useState } from "react"
import Link from "next/link"
import { Check, Copy, Download } from "lucide-react"
import { LiquidButton } from "@/components/ui/liquid-glass-button"
import { MAC_INSTALLER_URL, WINDOWS_INSTALLER_URL } from "@/lib/download"

// What to do right after signing up or paying: the three steps from here to
// a working interview, and a button that starts the installer download
// straight away (not a link to another page) for the visitor's own OS —
// Windows or Mac. SmallBird AI is a desktop app, so a phone gets the link to
// open on a laptop instead.

const DOWNLOAD_PAGE = "https://smallbirdai.com/download"

export function DownloadNextSteps({ email, onDone }: { email: string | null; onDone: () => void }) {
  // Only ever rendered inside a dialog opened in the browser, never on the
  // server, so navigator is safe to read up front.
  const [isPhone] = useState(
    () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent),
  )
  const [isMac] = useState(() => typeof navigator !== "undefined" && /Macintosh|Mac OS X/i.test(navigator.userAgent))
  const [started, setStarted] = useState(false)
  const platform = isMac
    ? { name: "Mac", url: MAC_INSTALLER_URL, file: "Smallbird-Mac.dmg", note: "Free · macOS 14.6 or later" }
    : { name: "Windows", url: WINDOWS_INSTALLER_URL, file: "Smallbird-Setup.exe", note: "Free · Windows 10 and 11" }
  const [copied, setCopied] = useState(false)

  const steps = [
    isPhone ? "Open smallbirdai.com/download on your laptop" : `Download and install SmallBird AI for ${platform.name}`,
    email ? `Open it and log in with ${email}` : "Open it and log in with the same email",
    "Start Interview Mode before your interview",
  ]

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(DOWNLOAD_PAGE)
      setCopied(true)
    } catch {
      // Clipboard blocked -- the link is written out in step 1 anyway.
    }
  }

  return (
    <div className="space-y-5">
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={step} className="flex items-start gap-3 text-sm">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
              {i + 1}
            </span>
            <span className="pt-0.5 text-foreground">{step}</span>
          </li>
        ))}
      </ol>

      {isPhone ? (
        <div className="space-y-2">
          <LiquidButton size="lg" className="w-full" onClick={copyLink}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Link copied" : "Copy download link"}
          </LiquidButton>
          <p className="text-center text-xs text-muted-foreground">We&apos;ve also sent the link to your email.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <LiquidButton asChild size="lg" className="w-full">
            <a href={platform.url} onClick={() => setStarted(true)}>
              <Download />
              {started ? "Download again" : `Download for ${platform.name}`}
            </a>
          </LiquidButton>
          <p className="text-center text-xs text-muted-foreground">
            {started
              ? `Downloading… open ${platform.file} when it finishes.`
              : platform.note}
          </p>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <Link href="/download" onClick={onDone} className="hover:text-foreground hover:underline">
          Other download options
        </Link>
        <button type="button" onClick={onDone} className="hover:text-foreground hover:underline">
          I&apos;ll do it later
        </button>
      </div>
    </div>
  )
}
