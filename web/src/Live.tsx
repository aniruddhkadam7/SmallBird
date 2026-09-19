import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { ApiError } from "./api";
import { askAnswer, spokenAnswer, splitAnswer, type Profile, type QA } from "./answer";
import { InterviewController, type LiveStatus, type Turn } from "./interview";
import { MicError } from "./mic";
import type { QAEntry, SessionResult } from "./types";

interface Props {
  profile: Profile;
  onFinished: (result: SessionResult) => void;
  onCancel: () => void;
}

type Phase = "ready" | "starting" | "live" | "conflict" | "failed";

const STATUS_LABEL: Record<LiveStatus, string> = {
  starting: "Connecting…",
  listening: "Listening",
  reconnecting: "Reconnecting…",
  paused: "Paused",
  ended: "Ended",
};

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function Live({ profile, onFinished, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [failure, setFailure] = useState("");
  const [status, setStatus] = useState<LiveStatus>("starting");
  const [hearing, setHearing] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [entries, setEntries] = useState<QAEntry[]>([]);
  const [level, setLevel] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [showFull, setShowFull] = useState(false);
  const [missedAudio, setMissedAudio] = useState(false);

  const controller = useRef<InterviewController | null>(null);
  const abort = useRef<AbortController | null>(null);
  const history = useRef<QA[]>([]);
  const entryId = useRef(0);
  const startedAt = useRef(0);
  // The end-of-session callback fires from a long-lived closure, so it reads
  // the latest transcript/answers through refs instead of stale state.
  const latest = useRef({ turns, entries });
  latest.current = { turns, entries };

  const patchEntry = useCallback((id: number, patch: Partial<QAEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const ctl = controller.current;
      if (!ctl || !question.trim()) return;

      // A new question supersedes any answer still streaming.
      abort.current?.abort();
      const signal = (abort.current = new AbortController()).signal;
      const id = ++entryId.current;
      setEntries((prev) => [...prev, { id, question, raw: "", done: false }]);
      setShowFull(false);

      try {
        const raw = await askAnswer(profile, history.current, question, ctl.sessionId, (text) => patchEntry(id, { raw: text }), signal);
        history.current.push({ question, answer: spokenAnswer(raw) });
        patchEntry(id, { done: true });
      } catch (err) {
        if (signal.aborted) patchEntry(id, { done: true });
        else patchEntry(id, { done: true, error: err instanceof Error ? err.message : "Couldn't generate an answer." });
      }
    },
    [profile, patchEntry],
  );

  // Keep the screen awake for the whole interview: a locked phone suspends
  // its microphone.
  useEffect(() => {
    if (phase !== "live") return;
    let lock: WakeLockSentinel | null = null;
    let hiddenAt = 0;

    const acquire = async () => {
      try {
        lock = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        // Unsupported or refused (low battery): the banner below still warns on background.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else {
        if (hiddenAt && Date.now() - hiddenAt > 3000) setMissedAudio(true);
        hiddenAt = 0;
        void acquire();
      }
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release();
    };
  }, [phase]);

  // Tear everything down if the user navigates away mid-interview.
  useEffect(
    () => () => {
      abort.current?.abort();
      void controller.current?.end();
    },
    [],
  );

  async function begin(force: boolean) {
    setPhase("starting");
    if (!controller.current) {
      controller.current = new InterviewController({
        onStatus: setStatus,
        onHearing: setHearing,
        onTurn: (turn) => setTurns((prev) => [...prev, turn]),
        onQuestion: (question) => void ask(question),
        onLevel: setLevel,
        onRemaining: setRemaining,
        onEnded: (message) => {
          abort.current?.abort();
          onFinished({
            entries: latest.current.entries,
            turns: latest.current.turns,
            message,
            durationSeconds: startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0,
          });
        },
      });
    }

    try {
      await controller.current.start(force);
      startedAt.current = Date.now();
      setPhase("live");
    } catch (err) {
      controller.current = null;
      if (err instanceof ApiError && err.code === "ACTIVE_SESSION_ELSEWHERE") {
        setPhase("conflict");
      } else {
        setFailure(err instanceof Error || err instanceof MicError ? err.message : "Couldn't start the interview.");
        setPhase("failed");
      }
    }
  }

  function answerThis() {
    const ctl = controller.current;
    if (!ctl) return;
    // Fall back to the last thing heard, so a question the auto-detector
    // skipped can still be answered with one tap.
    const question = ctl.takePending().trim() || turns[turns.length - 1]?.text || "";
    void ask(question);
  }

  if (phase === "ready") {
    return (
      <main className="screen center">
        <h2>Ready when you are</h2>
        <p className="muted">
          Your minutes start counting the moment you tap Start. Keep this screen on and the phone next to your laptop.
        </p>
        <button className="primary big" onClick={() => void begin(false)}>
          Start interview
        </button>
        <button className="link" onClick={onCancel}>
          Back
        </button>
      </main>
    );
  }

  if (phase === "starting") {
    return (
      <main className="screen center">
        <p className="muted">Connecting…</p>
      </main>
    );
  }

  if (phase === "conflict") {
    return (
      <main className="screen center">
        <h2>Interview running elsewhere</h2>
        <p className="muted">Your account already has an active interview on another device. You can end that one and continue here.</p>
        <button className="primary" onClick={() => void begin(true)}>
          End it and continue here
        </button>
        <button className="link" onClick={onCancel}>
          Cancel
        </button>
      </main>
    );
  }

  if (phase === "failed") {
    return (
      <main className="screen center">
        <h2>Couldn't start</h2>
        <p className="error">{failure}</p>
        <button className="primary" onClick={() => setPhase("ready")}>
          Try again
        </button>
        <button className="link" onClick={onCancel}>
          Back
        </button>
      </main>
    );
  }

  const current = entries[entries.length - 1];
  const parts = current ? splitAnswer(current.raw) : null;
  const lowOnTime = remaining > 0 && remaining <= 300;
  const problem = status === "reconnecting" || status === "paused";

  return (
    <main className="live">
      <header className={`topbar ${problem ? "problem" : ""}`}>
        <span className="dot" data-status={status} />
        <span>{STATUS_LABEL[status]}</span>
        <span className="meter small" aria-hidden>
          <span className="meter-fill" style={{ width: `${Math.min(1, Math.sqrt(level) * 2.2) * 100}%` }} />
        </span>
        <span className={`clock ${lowOnTime ? "low" : ""}`}>{formatClock(remaining)} left</span>
      </header>

      {missedAudio && (
        <p className="banner" onClick={() => setMissedAudio(false)}>
          This page was in the background, so audio may have been missed. Tap to dismiss.
        </p>
      )}

      <section className="card question">
        <span className="label">{hearing ? "Hearing" : current ? "Interviewer asked" : "Waiting"}</span>
        <p className={hearing ? "hearing" : ""}>{hearing || current?.question || "Listening for the interviewer's question…"}</p>
      </section>

      <section className="card answer">
        <span className="label">Suggested answer</span>
        {current?.error ? (
          <p className="error">{current.error}</p>
        ) : parts && parts.points ? (
          <>
            <div className="md points">
              <Markdown>{parts.points}</Markdown>
            </div>
            {parts.hasFull && parts.full && (
              <>
                <button className="link expand" onClick={() => setShowFull((v) => !v)}>
                  {showFull ? "Hide full answer" : "Full answer"}
                </button>
                {showFull && (
                  <div className="md full">
                    <Markdown>{parts.full}</Markdown>
                  </div>
                )}
              </>
            )}
          </>
        ) : current && !current.done ? (
          <p className="muted">Thinking…</p>
        ) : (
          <p className="muted">Answers appear here.</p>
        )}
      </section>

      <details className="drawer">
        <summary>Transcript ({turns.length})</summary>
        <ul>
          {turns.map((turn) => (
            <li key={turn.id}>
              <span>{turn.text}</span>
              <button className="link" onClick={() => void ask(turn.text)}>
                Answer
              </button>
            </li>
          ))}
        </ul>
      </details>

      <footer className="actions">
        <button onClick={() => controller.current?.discardPending()}>That was me</button>
        <button className="primary" onClick={answerThis}>
          Answer this
        </button>
        <button onClick={() => controller.current?.setPaused(status !== "paused")}>{status === "paused" ? "Resume" : "Pause"}</button>
        <button className="danger" onClick={() => void controller.current?.end()}>
          End
        </button>
      </footer>
    </main>
  );
}
