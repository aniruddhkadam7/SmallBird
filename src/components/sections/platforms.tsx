"use client"

import Image from "next/image"
import { ShieldCheck } from "lucide-react"
import { siZoom, siGooglemeet, siGotomeeting } from "simple-icons"
import teamsLogo from "@/assets/logo-teams.png"
import webexLogo from "@/assets/logo-webex.png"
import hangoutsLogo from "@/assets/logo-hangouts.png"

// Only real, widely-used video-meeting platforms with a real logo -- three
// via the open-source simple-icons set, plus Teams/Webex/Hangouts using the
// official logo files supplied directly for this site. Smallbird is a
// screen overlay rather than a platform-specific integration, so "works
// with" holds generally, but we're not fabricating a "verified N days ago"
// testing-pipeline claim we don't actually run.
const platforms = [
  { name: "Zoom", color: `#${siZoom.hex}`, icon: siZoom },
  { name: "Microsoft Teams", color: "#4B53BC", image: teamsLogo },
  { name: "Google Meet", color: `#${siGooglemeet.hex}`, icon: siGooglemeet },
  { name: "Webex", color: "#00BCEB", image: webexLogo },
  { name: "Google Hangouts", color: "#00897B", image: hangoutsLogo },
  { name: "GoToMeeting", color: `#${siGotomeeting.hex}`, icon: siGotomeeting },
]

export function Platforms() {
  return (
    <section className="border-t border-border py-14 px-4 sm:py-20">
      <div className="mx-auto max-w-4xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Supported <span className="text-primary">with</span>
        </h2>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-border px-4 py-1.5 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Works quietly on the video calls you already use
        </div>

        <div className="mt-10 flex gap-3 overflow-x-auto px-1 pb-2 sm:justify-center sm:overflow-visible">
          {platforms.map((p) => (
            <div
              key={p.name}
              className="flex w-36 shrink-0 flex-col items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-5 transition-transform hover:-translate-y-0.5"
            >
              <div className="flex h-12 items-center justify-center">
                {p.image ? (
                  <Image src={p.image} alt={p.name} className="h-12 w-auto object-contain" />
                ) : (
                  <svg viewBox="0 0 24 24" className="h-10 w-10" fill={p.color} aria-hidden="true">
                    <path d={p.icon!.path} />
                  </svg>
                )}
              </div>
              <div className="text-center">
                <div className="text-sm font-medium text-foreground">{p.name}</div>
                <div className="mt-1 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Works with
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-8 text-sm text-muted-foreground">
          Since Smallbird runs as a quiet overlay on your screen, it works the same way on any call — open one and try it yourself.
        </p>
      </div>
    </section>
  )
}
