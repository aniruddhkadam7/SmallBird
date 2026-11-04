"use client"

import Image from "next/image"
import { GifWindowFrame } from "@/components/blocks/gif-window-frame"
import answerGeneratingGif from "@/assets/interview-ai-realistic.gif"

export function ProductDemo() {
  return (
    <section id="product-demo" className="border-t border-border py-14 px-4 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            See how SmallBird AI works
          </h2>
          <p className="mt-4 text-muted-foreground">
            Start a session, and SmallBird AI listens, understands, and assists — in real time.
          </p>
        </div>

        <div className="mt-10 shadow-[0_0_60px_-20px_rgba(0,0,0,0.25)] dark:shadow-[0_0_60px_-20px_rgba(255,255,255,0.08)] rounded-xl">
          {/* Below md the frame takes the gif's own aspect ratio, so the glass
              hugs the gif instead of leaving a tall empty box around it. */}
          <GifWindowFrame className="aspect-[1616/973] h-auto sm:h-auto md:aspect-auto md:h-[38rem]">
            <Image
              src={answerGeneratingGif}
              alt="SmallBird AI assisting in real time during an interview"
              unoptimized
              fill
              className="object-contain"
            />
          </GifWindowFrame>
        </div>
      </div>
    </section>
  )
}
