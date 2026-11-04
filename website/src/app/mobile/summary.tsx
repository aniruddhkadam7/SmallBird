"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import Markdown from "react-markdown"
import { spokenAnswer } from "@/lib/mobile/answer"
import { saveTranscript, type SaveStatus } from "@/lib/mobile/transcripts"
import type { SessionResult } from "@/lib/mobile/types"

function transcriptText(result: SessionResult): string {
  const qa = result.entries
    .map((e, i) => `Q${i + 1}. ${e.question}\n\n${spokenAnswer(e.raw) || "(no answer)"}`)
    .join("\n\n---\n\n")
  const raw = result.turns.map((t) => t.text).join("\n")
  return `# SmallBird AI interview\n\n## Questions and suggested answers\n\n${qa || "(none)"}\n\n## Full transcript\n\n${raw || "(empty)"}\n`
}

export default function Summary({ result, onDone }: { result: SessionResult; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(result.saveStatus)
  const [retrying, setRetrying] = useState(false)
  const minutes = Math.max(1, Math.round(result.durationSeconds / 60))

  // The screen appears the moment the interview ends; the save finishes in the background.
  useEffect(() => {
    let current = true
    result.pendingSave?.then((outcome) => {
      if (current) setSaveStatus(outcome)
    })
    return () => {
      current = false
    }
  }, [result])
  const answered = result.entries.filter((e) => spokenAnswer(e.raw)).length

  async function copy() {
    try {
      await navigator.clipboard.writeText(transcriptText(result))
      setCopied(true)
    } catch {
      // Clipboard can be blocked; the answers are still on screen to read.
    }
  }

  async function retrySave() {
    if (!result.transcript) return
    setRetrying(true)
    try {
      await saveTranscript(result.transcript)
      setSaveStatus("saved")
    } catch {
      setSaveStatus("failed")
    } finally {
      setRetrying(false)
    }
  }

  return (
    <main className="page">
      <nav className="nav-row">
        <Link href="/" className="back">
          <span aria-hidden>‹</span> Back to smallbirdai.com
        </Link>
      </nav>

      <h1 className="title">Interview finished</h1>
      <p className="lede">
        {result.message} {result.durationSeconds > 0 && `About ${minutes} min · `}
        {answered} question{answered === 1 ? "" : "s"} answered.
      </p>

      {saveStatus === "saving" && (
        <section className="card callout">
          <p className="callout-title saving">Saving your transcript…</p>
          <p className="lede">This takes a moment. You can then open it on your dashboard.</p>
        </section>
      )}

      {saveStatus === "saved" && (
        <section className="card callout">
          <p className="callout-title">✓ Your transcript is saved</p>
          <p className="lede">Open your dashboard to read it again, or download it.</p>
          <Link href="/dashboard" className="btn primary big">
            View transcript on dashboard
          </Link>
        </section>
      )}

      {saveStatus === "failed" && (
        <section className="card">
          <p className="notice error">We couldn&apos;t save this transcript to your dashboard. Check your connection and try again.</p>
          <button type="button" className="btn primary big" onClick={retrySave} disabled={retrying}>
            {retrying ? "Saving…" : "Try saving again"}
          </button>
          <p className="fineprint">You can also copy the questions and answers below so nothing is lost.</p>
        </section>
      )}

      {saveStatus === "empty" && <p className="fineprint">No questions were answered, so there is nothing to save to your dashboard.</p>}

      <div className="actions-col">
        {answered > 0 && (
          <button type="button" className="btn small" onClick={copy}>
            {copied ? "Copied" : "Copy questions and answers"}
          </button>
        )}
        <button type="button" className="btn small" onClick={onDone}>
          Start another interview
        </button>
      </div>

      {result.entries.map((entry, i) => (
        <section className="card" key={entry.id}>
          <span className="eyebrow">Question {i + 1}</span>
          <p className="q-text">{entry.question}</p>
          <div className="md">
            <Markdown>{spokenAnswer(entry.raw)}</Markdown>
          </div>
        </section>
      ))}
    </main>
  )
}
