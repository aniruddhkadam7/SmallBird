import { useState } from "react";
import Markdown from "react-markdown";
import { spokenAnswer } from "./answer";
import type { SessionResult } from "./types";

function transcriptText(result: SessionResult): string {
  const qa = result.entries
    .map((e, i) => `Q${i + 1}. ${e.question}\n\n${spokenAnswer(e.raw) || "(no answer)"}`)
    .join("\n\n---\n\n");
  const raw = result.turns.map((t) => t.text).join("\n");
  return `# Smallbird interview\n\n## Questions and suggested answers\n\n${qa || "(none)"}\n\n## Full transcript\n\n${raw || "(empty)"}\n`;
}

export default function Summary({ result, onDone }: { result: SessionResult; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const minutes = Math.max(1, Math.round(result.durationSeconds / 60));

  async function copy() {
    try {
      await navigator.clipboard.writeText(transcriptText(result));
      setCopied(true);
    } catch {
      // Clipboard can be blocked; the answers are still on screen to read.
    }
  }

  return (
    <main className="screen">
      <h2>Interview finished</h2>
      <p className="muted">
        {result.message} {result.durationSeconds > 0 && `About ${minutes} min · `}
        {result.entries.length} question{result.entries.length === 1 ? "" : "s"} answered.
      </p>

      <div className="stack">
        <button className="primary" onClick={copy}>
          {copied ? "Copied" : "Copy questions, answers and transcript"}
        </button>
        <button onClick={onDone}>Back to start</button>
      </div>

      {result.entries.map((entry, i) => (
        <section className="card" key={entry.id}>
          <span className="label">Question {i + 1}</span>
          <p>{entry.question}</p>
          <div className="md">
            <Markdown>{spokenAnswer(entry.raw)}</Markdown>
          </div>
        </section>
      ))}
    </main>
  );
}
