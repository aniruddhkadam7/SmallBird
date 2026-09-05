"use client"

import Image from "next/image"
import { GifWindowFrame } from "@/components/blocks/gif-window-frame"
import answerGeneratingGif from "@/assets/answer-generating.gif"

export function ProductDemo() {
  return (
    <section id="product-demo" className="border-t border-border py-14 px-4 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            See how Smallbird works
          </h2>
          <p className="mt-4 text-muted-foreground">
            Start a session, and Smallbird listens, understands, and assists — in real time.
          </p>
        </div>

        <div className="mt-10 shadow-[0_0_60px_-20px_rgba(0,0,0,0.25)] dark:shadow-[0_0_60px_-20px_rgba(255,255,255,0.08)] rounded-xl">
          <GifWindowFrame className="h-96 sm:h-[32rem]">
            <Image
              src={answerGeneratingGif}
              alt="Smallbird generating a relevant answer during a conversation"
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
