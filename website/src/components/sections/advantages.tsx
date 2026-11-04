"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { LiquidButton } from "@/components/ui/liquid-glass-button"
import { GifWindowFrame } from "@/components/blocks/gif-window-frame"
import uploadContextGif from "@/assets/upload-context.gif"
import liveSttGif from "@/assets/live-stt-listening.gif"
import answerGeneratingGif from "@/assets/answer-generating.gif"

const features = [
  {
    title: "CV, job description, and document context",
    detail:
      "Load your resume and the job description before an interview — SmallBird AI grounds its assistance in what you actually gave it.",
    media: (
      <Image
        src={uploadContextGif}
        alt="Uploading a CV and job description as context in SmallBird AI"
        unoptimized
        fill
        className="object-contain"
      />
    ),
  },
  {
    title: "Local, real-time transcription",
    detail:
      "Speech-to-text runs on your machine, keeping the audio pipeline close to home as the conversation happens.",
    media: (
      <Image
        src={liveSttGif}
        alt="SmallBird AI listening and transcribing a conversation live"
        unoptimized
        fill
        className="object-contain"
      />
    ),
  },
  {
    title: "Context-aware, relevant responses",
    detail:
      "Suggestions are generated as the conversation unfolds, grounded in the context you've loaded in.",
    media: (
      <Image
        src={answerGeneratingGif}
        alt="SmallBird AI generating a relevant answer during a conversation"
        unoptimized
        fill
        className="object-contain"
      />
    ),
  },
]

export function Advantages() {
  const router = useRouter()
  const [active, setActive] = useState(0)

  return (
    <section id="features" className="border-t border-border py-14 px-4 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            <span className="text-primary">Everything you need</span>, mid-conversation
          </h2>
          <p className="mt-4 text-muted-foreground">
            Context, transcription, and assistance — handled live while the
            conversation is still happening.
          </p>
        </div>

        <div className="mt-10 grid gap-12 lg:grid-cols-[0.85fr_1.4fr]">
          <div className="flex flex-col justify-between gap-3 lg:h-96 lg:gap-0">
            {features.map((feature, i) => (
              <button
                key={feature.title}
                type="button"
                onClick={() => setActive(i)}
                className={cn(
                  "flex w-full cursor-pointer gap-4 rounded-xl border-2 p-4 text-left transition-colors",
                  active === i
                    ? "border-foreground bg-foreground/[0.06] shadow-sm"
                    : "border-foreground/25 hover:border-foreground/50 hover:bg-foreground/[0.03]",
                )}
              >
                <span
                  className={cn(
                    "text-2xl font-semibold tabular-nums transition-colors",
                    active === i ? "text-foreground" : "text-foreground/45",
                  )}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <p className="font-medium text-foreground">{feature.title}</p>
                  <p className="mt-0.5 text-sm text-foreground/70">{feature.detail}</p>
                </div>
              </button>
            ))}
          </div>
          <div className="shadow-[0_0_60px_-20px_rgba(0,0,0,0.25)] dark:shadow-[0_0_60px_-20px_rgba(255,255,255,0.08)] rounded-xl">
            <GifWindowFrame>{features[active].media}</GifWindowFrame>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center gap-2">
          <LiquidButton size="lg" onClick={() => router.push("/download")}>
            Get Started
            <ArrowRight className="h-4 w-4" />
          </LiquidButton>
          <p className="text-xs text-muted-foreground">No card required</p>
        </div>
      </div>
    </section>
  )
}
