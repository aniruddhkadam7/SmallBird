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
        <div className="flex w-full items-center justify-between gap-4">
          <div>
            <div className="text-xs text-muted-foreground">{formatWhen(transcript.started_at_ms)}</div>
            <div className="mt-1 font-semibold text-foreground">{title}</div>
            <div className="mt-2 flex items-center gap-1.5">
              <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-xs font-medium text-foreground">
                Interview
              </span>
              <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-xs font-medium text-foreground">
                {transcript.turns.length} question{transcript.turns.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
              Ended · {formatDuration(transcript.started_at_ms, transcript.ended_at_ms)}
            </div>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5"
            >
              {expanded ? "Hide Transcript" : "View Transcript"}
            </button>
          </div>
        </div>
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
