"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AudioLines, MessageCircle, Star } from "lucide-react"
import Markdown from "react-markdown"
import { ApiError } from "@/lib/mobile/api"
import { askAnswer, spokenAnswer, splitAnswer, type Profile, type QA } from "@/lib/mobile/answer"
import { InterviewController, type LiveStatus, type Turn } from "@/lib/mobile/interview"
import { MicError, prepareAudio, type PreparedAudio } from "@/lib/mobile/mic"
import type { QAEntry, SessionResult } from "@/lib/mobile/types"

type Phase = "starting" | "live" | "conflict" | "failed"

const STATUS_LABEL: Record<LiveStatus, string> = {
  starting: "Connecting…",
  listening: "Listening",
  reconnecting: "Reconnecting…",
  paused: "Paused",
  ended: "Ended",
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

interface ViewProps {
  status: LiveStatus
  level: number
  remaining: number
  hearing: string
  entry: QAEntry | null
  turns: Turn[]
  showFull: boolean
  missedAudio: boolean
  onToggleFull: () => void
  onDismissMissed: () => void
  onAskTurn: (text: string) => void
  onThatWasMe: () => void
  onAnswerThis: () => void
  onTogglePause: () => void
  onEnd: () => void
}

// Laid out like the desktop overlay: a slim status bar, a live-transcript
// strip, then the Question / Answer panel, with the actions in reach of a thumb.
export function LiveView(p: ViewProps) {
  const parts = p.entry ? splitAnswer(p.entry.raw) : null
  const lowOnTime = p.remaining > 0 && p.remaining <= 300
  const problem = p.status === "reconnecting" || p.status === "paused"

  return (
    <main className="live">
      <header className={`island bar ${problem ? "problem" : ""}`}>
        <span className="dot" data-status={p.status} />
        <span className="bar-label">{STATUS_LABEL[p.status]}</span>
        <span className="meter" aria-hidden>
          <span className="meter-fill" style={{ width: `${Math.min(1, Math.sqrt(p.level) * 2.2) * 100}%` }} />
        </span>
        <span className={`clock ${lowOnTime ? "low" : ""}`}>{formatClock(p.remaining)} left</span>
      </header>

      {p.missedAudio && (
        <button type="button" className="banner" onClick={p.onDismissMissed}>
          This page was in the background, so audio may have been missed. Tap to dismiss.
        </button>
      )}

      <section className="island strip">
        <AudioLines className="strip-icon" aria-hidden />
        <p className={p.hearing ? "strip-text hearing" : "strip-text"}>{p.hearing || "Listening for the interviewer…"}</p>
      </section>

      <section className="island panel">
        {p.entry ? (
          <>
            <p className="qa-line">
              <MessageCircle className="qa-icon" aria-hidden />
              <span>
                <strong>Question:</strong> {p.entry.question}
              </span>
            </p>

            {p.entry.error ? (
              <p className="error-text">{p.entry.error}</p>
            ) : parts && parts.points ? (
              <div className="qa-answer">
                <p className="qa-line">
                  <Star className="qa-icon star" aria-hidden />
                  <strong>Answer:</strong>
                </p>
                <div className="md points">
                  <Markdown>{parts.points}</Markdown>
                </div>
                {parts.hasFull && parts.full && (
                  <>
                    <button type="button" className="chip inline" onClick={p.onToggleFull}>
                      {p.showFull ? "Hide full answer" : "Full answer"}
                    </button>
                    {p.showFull && (
                      <div className="md full">
                        <Markdown>{parts.full}</Markdown>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : !p.entry.done ? (
              <p className="dim">Thinking…</p>
            ) : null}
          </>
        ) : (
          <p className="dim">Answers appear here. Tap &quot;Answer this&quot; if a question was missed.</p>
        )}
      </section>

      <details className="island drawer">
        <summary>Transcript ({p.turns.length})</summary>
        <ul>
          {p.turns.map((turn) => (
            <li key={turn.id}>
              <span>{turn.text}</span>
              <button type="button" className="chip inline" onClick={() => p.onAskTurn(turn.text)}>
                Answer
              </button>
            </li>
          ))}
        </ul>
      </details>

      <footer className="actions">
        <button type="button" className="chip" onClick={p.onThatWasMe}>
          That was me
        </button>
        <button type="button" className="chip accent" onClick={p.onAnswerThis}>
          Answer this
        </button>
        <button type="button" className="chip" onClick={p.onTogglePause}>
          {p.status === "paused" ? "Resume" : "Pause"}
        </button>
        <button type="button" className="chip end" onClick={p.onEnd}>
          End
        </button>
      </footer>
    </main>
  )
}

interface Props {
  profile: Profile
  /** Audio prepared inside the tap that started the interview (see prepareAudio). */
  audio: PreparedAudio | null
  onFinished: (result: SessionResult) => void
  onCancel: () => void
}

export default function Live({ profile, audio, onFinished, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>("starting")
  const [failure, setFailure] = useState("")
  const [status, setStatus] = useState<LiveStatus>("starting")
  const [hearing, setHearing] = useState("")
  const [turns, setTurns] = useState<Turn[]>([])
  const [entries, setEntries] = useState<QAEntry[]>([])
  const [level, setLevel] = useState(0)
  const [remaining, setRemaining] = useState(0)
  const [showFull, setShowFull] = useState(false)
  const [missedAudio, setMissedAudio] = useState(false)

  const controller = useRef<InterviewController | null>(null)
  const abort = useRef<AbortController | null>(null)
  const history = useRef<QA[]>([])
  const entryId = useRef(0)
  const startedAt = useRef(0)
  const began = useRef(false)
  const mounted = useRef(false)
  // The end-of-session callback fires from a long-lived closure, so it reads
  // the latest transcript/answers through a ref instead of stale state.
  const latest = useRef({ turns, entries })
  useEffect(() => {
    latest.current = { turns, entries }
  }, [turns, entries])

  const patchEntry = useCallback((id: number, patch: Partial<QAEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }, [])

  const ask = useCallback(
    async (question: string) => {
      const ctl = controller.current
      if (!ctl || !question.trim()) return

      // A new question supersedes any answer still streaming.
      abort.current?.abort()
      const signal = (abort.current = new AbortController()).signal
      const id = ++entryId.current
      setEntries((prev) => [...prev, { id, question, raw: "", done: false }])
      setShowFull(false)

      try {
        const raw = await askAnswer(profile, history.current, question, ctl.sessionId, (text) => patchEntry(id, { raw: text }), signal)
        history.current.push({ question, answer: spokenAnswer(raw) })
        patchEntry(id, { done: true })
      } catch (err) {
        if (signal.aborted) patchEntry(id, { done: true })
        else patchEntry(id, { done: true, error: err instanceof Error ? err.message : "Couldn't generate an answer." })
      }
    },
    [profile, patchEntry],
  )

  const begin = useCallback(
    async (force: boolean, prepared: PreparedAudio | null) => {
      setPhase("starting")
      if (!controller.current) {
        controller.current = new InterviewController({
          onStatus: setStatus,
          onHearing: setHearing,
          onTurn: (turn) => setTurns((prev) => [...prev, turn]),
          onQuestion: (question) => void ask(question),
          onLevel: setLevel,
          onRemaining: setRemaining,
          onEnded: (message) => {
            abort.current?.abort()
            onFinished({
              entries: latest.current.entries,
              turns: latest.current.turns,
              message,
              durationSeconds: startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0,
            })
          },
        })
      }

      try {
        await controller.current.start(force, prepared)
        startedAt.current = Date.now()
        setPhase("live")
      } catch (err) {
        controller.current = null
        if (err instanceof ApiError && err.code === "ACTIVE_SESSION_ELSEWHERE") {
          setPhase("conflict")
        } else {
          setFailure(err instanceof Error || err instanceof MicError ? err.message : "Couldn't start the interview.")
          setPhase("failed")
        }
      }
    },
    [ask, onFinished],
  )

  // Starts as soon as this screen opens: the tap that opened it already
  // prepared the audio. `began` keeps React's dev double-mount from minting
  // two sessions, and the deferred teardown below lets that simulated
  // remount cancel itself while a real unmount still ends the session.
  useEffect(() => {
    mounted.current = true
    if (!began.current) {
      began.current = true
      void begin(false, audio)
    }
    return () => {
      mounted.current = false
      setTimeout(() => {
        if (mounted.current) return
        abort.current?.abort()
        void controller.current?.end()
      }, 0)
    }
    // Runs once per mount by design; `begin` and `audio` are captured for that first start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the screen awake for the whole interview: a locked phone suspends its microphone.
  useEffect(() => {
    if (phase !== "live") return
    let lock: WakeLockSentinel | null = null
    let hiddenAt = 0

    const acquire = async () => {
      try {
        lock = (await navigator.wakeLock?.request("screen")) ?? null
      } catch {
        // Unsupported or refused (low battery): the banner still warns after time in the background.
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now()
      } else {
        if (hiddenAt && Date.now() - hiddenAt > 3000) setMissedAudio(true)
        hiddenAt = 0
        void acquire()
      }
    }
    void acquire()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      void lock?.release()
    }
  }, [phase])

  if (phase === "starting") {
    return (
      <main className="live center-screen">
        <p className="dim">Connecting…</p>
      </main>
    )
  }

  if (phase === "conflict") {
    return (
      <main className="live center-screen">
        <h2>Interview running elsewhere</h2>
        <p className="dim">Your account already has an active interview on another device. You can end that one and continue here.</p>
        {/* prepareAudio() must run inside this tap, before anything is awaited. */}
        <button type="button" className="chip accent big" onClick={() => void begin(true, prepareAudio())}>
          End it and continue here
        </button>
        <button type="button" className="chip" onClick={onCancel}>
          Cancel
        </button>
      </main>
    )
  }

  if (phase === "failed") {
    return (
      <main className="live center-screen">
        <h2>Couldn&apos;t start</h2>
        <p className="error-text">{failure}</p>
        <button type="button" className="chip accent big" onClick={onCancel}>
          Back
        </button>
      </main>
    )
  }

  return (
    <LiveView
      status={status}
      level={level}
      remaining={remaining}
      hearing={hearing}
      entry={entries[entries.length - 1] ?? null}
      turns={turns}
      showFull={showFull}
      missedAudio={missedAudio}
      onToggleFull={() => setShowFull((v) => !v)}
      onDismissMissed={() => setMissedAudio(false)}
      onAskTurn={(text) => void ask(text)}
      onThatWasMe={() => controller.current?.discardPending()}
      onAnswerThis={() => {
        const ctl = controller.current
        if (!ctl) return
        // Fall back to the last thing heard, so a question the auto-detector
        // skipped can still be answered with one tap.
        void ask(ctl.takePending().trim() || turns[turns.length - 1]?.text || "")
      }}
      onTogglePause={() => controller.current?.setPaused(status !== "paused")}
      onEnd={() => void controller.current?.end()}
    />
  )
}
