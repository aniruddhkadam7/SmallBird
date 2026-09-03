"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

interface Turn {
  question: string
  answer: string
}

interface Transcript {
  id: string
  started_at_ms: number
  ended_at_ms: number
  role: string | null
  company: string | null
  turns: Turn[]
}

function formatWhen(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function formatDuration(startedMs: number, endedMs: number) {
  const totalSeconds = Math.max(0, Math.round((endedMs - startedMs) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}

function InterviewCard({ transcript }: { transcript: Transcript }) {
  const [expanded, setExpanded] = useState(false)
  const title = [transcript.role, transcript.company].filter(Boolean).join(" · ") || "Interview"

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between gap-4 text-left"
        >
          <div>
            <div className="font-semibold text-foreground">{title}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {formatWhen(transcript.started_at_ms)} · {formatDuration(transcript.started_at_ms, transcript.ended_at_ms)} ·{" "}
              {transcript.turns.length} question{transcript.turns.length === 1 ? "" : "s"}
            </div>
          </div>
          <span className="shrink-0 text-sm text-muted-foreground">{expanded ? "Hide" : "View"}</span>
        </button>
      </CardHeader>

      {expanded && (
        <CardContent className="flex flex-col gap-5 px-6">
          {transcript.turns.map((turn, i) => (
            <div key={i} className="flex flex-col gap-2 border-t border-border pt-4 first:border-t-0 first:pt-0">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Interviewer</div>
                <p className="mt-1 text-sm text-foreground">{turn.question}</p>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-primary">Smallbird</div>
                <p className="mt-1 text-sm leading-relaxed text-foreground">{turn.answer}</p>
              </div>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  )
}

export function InterviewsList({ transcripts }: { transcripts: Transcript[] }) {
  if (transcripts.length === 0) {
    return (
      <p className="mt-12 text-center text-sm text-muted-foreground">
        No interviews yet. Once you complete a session in the desktop app while signed in, it'll show up here.
      </p>
    )
  }

  return (
    <div className="mt-10 flex flex-col gap-4">
      {transcripts.map((t) => (
        <InterviewCard key={t.id} transcript={t} />
      ))}
    </div>
  )
}
