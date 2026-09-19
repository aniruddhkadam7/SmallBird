"use client"

import { useEffect, useRef, useState } from "react"
import { AudioLines } from "lucide-react"
import { InterviewController, type LiveStatus, type Turn } from "@/lib/mobile/interview"
import { MicError, prepareAudio, type PreparedAudio } from "@/lib/mobile/mic"

/** Only the last few finished sentences are listed; this is a check, not a transcript. */
const TURNS_SHOWN = 4

type TestPhase = "connecting" | "listening" | "failed"

interface ViewProps {
  phase: TestPhase
  status: LiveStatus
  failure: string
  level: number
  hearing: string
  turns: Turn[]
  closing: boolean
  onDone: () => void
  onStartInterview: () => void
}

export function MicTestView({ phase, status, failure, level, hearing, turns, closing, onDone, onStartInterview }: ViewProps) {
  const heard = hearing.trim().length > 0 || turns.length > 0
  const shown = turns.slice(-TURNS_SHOWN)
  // sqrt stretches the quiet end so a distant laptop speaker still visibly moves the bar.
  const fill = Math.min(1, Math.sqrt(level) * 2.2)

  return (
    <main className="page">
      <nav className="nav-row">
        <button type="button" className="back linklike" onClick={onDone} disabled={closing || phase === "connecting"}>
          <span aria-hidden>‹</span> Back
        </button>
      </nav>

      <h1 className="title">Microphone test</h1>
      <p className="lede">
        Speak, or play the interviewer&apos;s voice on your laptop&apos;s speakers. What the phone hears shows up below, live.
      </p>

      <section className="card">
        <div className="test-head">
          <AudioLines className="test-icon" aria-hidden />
          <span className="test-status" data-heard={heard}>
            {phase === "connecting"
              ? "Connecting…"
              : phase === "failed"
                ? "Couldn't start"
                : status === "reconnecting"
                  ? "Reconnecting…"
                  : heard
                    ? "✓ The phone can hear it"
                    : "Listening…"}
          </span>
        </div>
        <div className="meter" aria-hidden>
          <div className="meter-fill" style={{ width: `${fill * 100}%` }} data-heard={heard} />
        </div>

        {phase === "failed" ? (
          <p className="notice error">{failure}</p>
        ) : (
          <div className="transcript-box" aria-live="polite">
            {shown.map((turn) => (
              <p key={turn.id}>{turn.text}</p>
            ))}
            {hearing && <p className="partial">{hearing}</p>}
            {!heard && <p className="placeholder">Words will appear here as you speak…</p>}
          </div>
        )}
      </section>

      <p className="fineprint">The test uses a few seconds of your minutes. Don&apos;t wear headphones: the phone can only hear the laptop&apos;s speakers.</p>

      <div className="actions-col">
        <button type="button" className="btn primary big" onClick={onStartInterview} disabled={closing || phase === "connecting"}>
          {closing ? "One moment…" : "Start interview"}
        </button>
        <button type="button" className="btn small" onClick={onDone} disabled={closing || phase === "connecting"}>
          Done
        </button>
      </div>
    </main>
  )
}

interface Props {
  audio: PreparedAudio | null
  /** Back to the setup screen. */
  onDone: () => void
  /** `audio` was prepared inside this tap; the test session has already been closed. */
  onStartInterview: (audio: PreparedAudio | null) => void
}

// The test is a real, very short session (so the transcript is exactly what
// the interview would produce). It's closed before leaving, which bills only
// the seconds it ran and frees the account's single active-session slot.
export default function MicTest({ audio, onDone, onStartInterview }: Props) {
  const [phase, setPhase] = useState<TestPhase>("connecting")
  const [status, setStatus] = useState<LiveStatus>("starting")
  const [failure, setFailure] = useState("")
  const [level, setLevel] = useState(0)
  const [hearing, setHearing] = useState("")
  const [turns, setTurns] = useState<Turn[]>([])
  const [closing, setClosing] = useState(false)

  const controller = useRef<InterviewController | null>(null)
  const began = useRef(false)
  const mounted = useRef(false)
  const closingRef = useRef(false)

  useEffect(() => {
    mounted.current = true

    if (!began.current) {
      began.current = true
      const ctl = new InterviewController({
        onStatus: setStatus,
        onHearing: setHearing,
        onTurn: (turn) => setTurns((prev) => [...prev, turn]),
        onQuestion: () => {},
        onLevel: setLevel,
        onRemaining: () => {},
        onEnded: (message) => {
          // Ended by the server (started elsewhere / out of minutes), not by us leaving.
          if (closingRef.current) return
          setFailure(message)
          setPhase("failed")
        },
      })
      controller.current = ctl
      ctl.start(false, audio).then(
        () => setPhase("listening"),
        (err: unknown) => {
          setFailure(err instanceof Error || err instanceof MicError ? err.message : "Couldn't start the microphone test.")
          setPhase("failed")
        },
      )
    }

    return () => {
      mounted.current = false
      // React (dev) simulates an unmount/remount on mount; deferring the
      // teardown lets that remount cancel it, while a real unmount still
      // closes the session.
      setTimeout(() => {
        if (!mounted.current) void controller.current?.end()
      }, 0)
    }
  }, [audio])

  async function closeTest() {
    closingRef.current = true
    setClosing(true)
    await controller.current?.end()
  }

  return (
    <MicTestView
      phase={phase}
      status={status}
      failure={failure}
      level={level}
      hearing={hearing}
      turns={turns}
      closing={closing}
      onDone={() => {
        void closeTest().then(onDone)
      }}
      onStartInterview={() => {
        // Prepared in the tap, before the test session is closed (which takes a network call).
        const next = prepareAudio()
        void closeTest().then(() => onStartInterview(next))
      }}
    />
  )
}
