"use client"

import { useState } from "react"
import Image from "next/image"
import { Video, Eye, MonitorX, PanelBottomClose, BellOff } from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { MockupFrame } from "@/components/ui/mockup"
import { PovCompare } from "@/components/blocks/pov-compare"
import { cn } from "@/lib/utils"
import taskManagerGif from "@/assets/stealth-task-manager.gif"
import taskbarGif from "@/assets/stealth-taskbar.gif"
import systemTrayGif from "@/assets/stealth-system-tray.gif"

const points = [
  {
    number: "01",
    icon: Eye,
    title: "Invisible on screen share",
    description: "Smallbird's assistance appears in its own window on your screen — separate from the call itself. If you share your screen or someone watches you present, they see a normal call, never your overlay.",
    proof: <PovCompare compact fill hideLabels />,
    proofLabel: "Drag to compare — what you see vs. what they see",
    ownsLabel: true,
  },
  {
    number: "02",
    icon: MonitorX,
    title: "Hidden from Task Manager",
    description: "Doesn't clutter the process list — nothing unusual to spot if someone glances at what's running on your machine.",
    proof: (
      <Image
        src={taskManagerGif}
        alt="Hiding Smallbird from Task Manager"
        unoptimized
        className="max-h-64 w-auto rounded-lg object-contain shadow-2xl"
      />
    ),
    proofLabel: "Doesn't show up in the process list",
  },
  {
    number: "03",
    icon: PanelBottomClose,
    title: "Hidden from the taskbar",
    description: "Hide the window from the taskbar with one click, right when you need it gone.",
    proof: (
      <Image
        src={taskbarGif}
        alt="Hiding Smallbird from the taskbar"
        unoptimized
        className="w-auto max-w-full rounded-lg object-contain shadow-2xl"
      />
    ),
    proofLabel: "One click to hide the taskbar icon",
  },
  {
    number: "04",
    icon: BellOff,
    title: "Hidden from the system tray",
    description: "Tuck it away from the system tray too, so there's no icon sitting in plain sight.",
    proof: (
      <Image
        src={systemTrayGif}
        alt="Hiding Smallbird from the system tray"
        unoptimized
        className="w-auto max-w-full rounded-lg object-contain shadow-2xl"
      />
    ),
    proofLabel: "No icon left in the system tray",
  },
]

export function Privacy() {
  const [activeTab, setActiveTab] = useState("0")
  const activePoint = points[Number(activeTab)]

  return (
    <section id="privacy" className="scroll-mt-16 border-t border-border py-14 px-4 sm:py-20">
      <div id="security" className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Privacy by design
          </h2>
          <p className="mt-4 text-muted-foreground">
            Important conversations deserve a thoughtful approach to data.
            Here's how Smallbird is built — no unsupported claims, just what's
            actually true.
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} orientation="vertical" className="mt-14 flex-col lg:grid lg:grid-cols-[1fr_1.3fr] lg:items-center lg:gap-10">
          <TabsList variant="line" className="h-auto w-full flex-col items-stretch gap-2 bg-transparent p-0">
            {points.map((point, i) => (
              <TabsTrigger
                key={point.title}
                value={String(i)}
                className="group h-auto w-full items-start justify-start gap-4 whitespace-normal rounded-xl border border-border bg-muted/60 px-4 py-4 text-left shadow-sm after:hidden hover:bg-muted data-[state=active]:border-primary/50 data-[state=active]:bg-muted data-[state=active]:shadow-md data-[state=active]:ring-1 data-[state=active]:ring-primary/20"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground/70 transition-colors group-data-[state=active]:border-primary/40 group-data-[state=active]:bg-primary/10 group-data-[state=active]:text-primary">
                  <point.icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1 whitespace-normal">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-base font-semibold text-foreground">
                      {point.title}
                    </h3>
                    <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground/60">
                      {point.number}
                    </span>
                  </div>
                  <p className="mt-1.5 hidden w-full text-wrap text-sm leading-relaxed text-muted-foreground group-data-[state=active]:block">
                    {point.description}
                  </p>
                </div>
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="mt-8 lg:mt-0">
            {activePoint.ownsLabel ? (
              <div className="mb-3 flex items-center justify-between px-0.5 text-base font-semibold text-foreground">
                <span>Candidate view</span>
                <span>Interviewer view</span>
              </div>
            ) : null}

            <MockupFrame
              size={activePoint.ownsLabel ? undefined : "small"}
              className={cn(
                "relative aspect-[1616/973] w-full items-center justify-center bg-neutral-950 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.35)]",
                activePoint.ownsLabel && "p-0",
              )}
            >
              {points.map((point, i) => (
                <TabsContent
                  key={point.title}
                  value={String(i)}
                  forceMount
                  className={cn(
                    "absolute inset-0 m-0 flex items-center justify-center data-[state=inactive]:hidden",
                    point.ownsLabel ? "p-0" : "p-6",
                  )}
                >
                  {!point.ownsLabel ? (
                    <span className="absolute top-4 left-4 z-10 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                      <Video className="h-3 w-3" />
                      {point.proofLabel}
                    </span>
                  ) : null}
                  {point.proof}
                </TabsContent>
              ))}
            </MockupFrame>
          </div>
        </Tabs>
      </div>
    </section>
  )
}
