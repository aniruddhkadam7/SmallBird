import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { TranscriptSegment } from "./types";
import {
  loadOverlaySettings,
  saveOverlaySettings,
  SIZE_FRACTIONS,
  type AnswerLength,
  type OverlaySettings,
  type OverlaySize,
  type ResponseStyle,
} from "./overlaySettings";
import { OverlaySettingsPanel } from "./OverlaySettingsPanel";
import {
  AUTO_AI_SILENCE_MS_COMPLETE,
  AUTO_AI_SILENCE_MS_INCOMPLETE,
  classifyQuestionCompleteness,
  joinSpeech,
} from "./questionCompleteness";
import { AudioLevelBars, useSttSpeaking } from "./ui";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  GearIcon,
  MessageIcon,
  MicIcon,
  MicOffIcon,
  MoreVerticalIcon,
  MoveIcon,
  ResizeIcon,
  SendIcon,
  SpeakerIcon,
  StarIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "./OverlayIcons";
import { loadLlmProvider } from "./llmProviderSetting";
import { getEntitlement } from "./auth";

function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

interface OverlayCaptureStatus {
  excluded: boolean;
}

/// One exchange in the running conversation.
///
/// `answer` is empty while the reply is still streaming; `pending` marks the
/// turn currently being answered so the UI can show a thinking state without a
/// separate top-level status variable.
interface Turn {
  id: string;
  question: string;
  answer: string;
  pending: boolean;
  failed?: boolean;
  /// When this turn was asked — Date.now() at creation. Rendered as a
  /// timestamp under the answer; local-only, never sent to the backend.
  askedAt: number;
  /// Local-only reaction on the answer — never sent anywhere, just a
  /// personal "was this good" marker for the candidate to glance back at.
  feedback?: "up" | "down" | null;
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

const overlayWindow = getCurrentWebviewWindow();

/// Cap on how tall the question box can grow before it scrolls internally
/// instead of continuing to shrink the conversation area above it.
const MAX_QUESTION_INPUT_PX = 160;

/// Fixed label for a screen-analysis turn — matches the backend's
/// `ANALYZE_SCREEN_QUESTION_LABEL` (commands.rs), since there's no real
/// transcribed question to show; it's also what gets replayed as this turn's
/// "question" in later questions' conversation history.
const ANALYZE_SCREEN_QUESTION_LABEL = "What's on my screen?";

/// Cycle order for the resize icon — small -> medium -> large -> small.
const SIZE_ORDER: OverlaySize[] = ["small", "medium", "large"];

/// Range for the header's opacity slider. The floor matches
/// `MIN_USABLE_OPACITY` in overlaySettings.ts — below that the overlay is hard
/// to find on a busy desktop, and a user who cannot see it cannot drag the
/// slider back up.
const OPACITY_MIN = 0.15;
const OPACITY_MAX = 1;

// Auto AI silence-window constants, the completeness classifier, and
// joinSpeech() now live in questionCompleteness.ts, shared with Custom
// Agents' overlay so both Auto AI implementations behave identically.

/// react-markdown's `code` renderer — fenced code blocks (```python ... ```)
/// get real syntax highlighting (VS Code's own Dark+ theme) instead of flat
/// monochrome text, since a coding-interview answer is far more scannable
/// with the same coloring an interviewer would see reading it in an editor.
/// Inline code (`like this`) has no `language-xxx` class and stays a plain
/// <code> pill — only fenced blocks get the highlighter.
function MarkdownCode({ className, children, ...rest }: React.ComponentPropsWithoutRef<"code">) {
  const language = /language-(\w+)/.exec(className ?? "")?.[1];
  if (!language) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }
  return (
    <SyntaxHighlighter
      language={language}
      style={vscDarkPlus}
      customStyle={{
        margin: 0,
        padding: "8px 10px",
        background: "rgba(0, 0, 0, 0.35)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        borderRadius: 6,
        fontSize: "0.85em",
        lineHeight: 1.45,
        // The overlay is narrow — wrap long lines instead of the theme's
        // default horizontal scroll, matching how the rest of the answer
        // already wraps.
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      }}
      codeTagProps={{
        style: {
          fontFamily: '"Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        },
      }}
    >
      {String(children).replace(/\n$/, "")}
    </SyntaxHighlighter>
  );
}

export function InterviewOverlay() {
  // The whole conversation, oldest first. Nothing is ever removed or replaced
  // — a new question appends, and streaming deltas only ever mutate the last
  // turn's answer.
  const [turns, setTurns] = useState<Turn[]>([]);
  // Which turn the single-card panel is showing — `null` means "follow the
  // newest turn" (the common case); an explicit index means the candidate
  // paged back to review an earlier one via the ⌘←/⌘→ buttons. Sending a new
  // question always snaps back to `null` so the answer streaming in is what
  // shows, regardless of where they'd paged to.
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  // Chat mode: a manual, typed-only way to ask something without touching
  // the live-transcript buffer — see `sendChat`. Off by default; the
  // overlay's primary flow stays transcript + Ask AI / Analyze Screen.
  const [chatMode, setChatMode] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  // Whether Row B (status readout + Auto AI/opacity/settings) is revealed —
  // tucked behind the "⋮" (More) icon in Row A rather than always visible.
  const [moreOpen, setMoreOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captureExcluded, setCaptureExcluded] = useState<boolean | null>(null);
  // Whether audio capture is confirmed actually running, so the header can
  // say "Listening" truthfully instead of unconditionally the moment the
  // overlay opens. `start_system_audio_capture` now only resolves once
  // WASAPI + STT are both confirmed ready (or rejects with a real error) —
  // see commands.rs's start_capture_inner — so this reflects real state,
  // not an assumption. "capture already running" (a second, harmless
  // invocation racing an already-successful start from InterviewSetup) is
  // treated as active too, not an error.
  const [captureActive, setCaptureActive] = useState(false);
  // Mic/system-audio mute: true once `pause_recording` has been confirmed —
  // audio capture keeps running internally but nothing reaches STT or the
  // transcript while muted (see commands.rs's pause_recording doc comment).
  const [muted, setMuted] = useState(false);
  const [muteBusy, setMuteBusy] = useState(false);
  // True only while STT is actively producing transcript output right now —
  // gates the listening animation so it doesn't run through silence just
  // because capture is technically still open.
  const sttSpeaking = useSttSpeaking();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  // Shows the opacity percentage in the header for a moment after adjusting.
  const [opacityHint, setOpacityHint] = useState(false);
  const [settings, setSettings] = useState<OverlaySettings>(() => loadOverlaySettings());
  // Mirrors `settings` for the mount-only overlay:reset-session listener
  // below, which needs the *current* captureProtection preference on every
  // reopen — a plain closure over `settings` in a `useEffect(..., [])`
  // would stay pinned to whatever it was at mount, missing any toggle
  // change made afterward.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Remaining plan balance at the moment this session started, in seconds —
  // ticked down locally by elapsedSeconds rather than re-fetched every
  // second, so the display doesn't depend on network latency. The real
  // enforcement happens server-side (see usage-report/entitlement checks);
  // this is purely a visible countdown so the user isn't surprised by
  // running out mid-answer.
  const [remainingSecondsAtStart, setRemainingSecondsAtStart] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const questionRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Everything the interviewer has said since the last "Ask AI", as finalized
  // by STT. This is the buffer that makes the field behave like continuous
  // dictation across pauses.
  //
  // The STT layer finalizes an utterance whenever it hears trailing silence,
  // and then starts a *fresh* segment for whatever is said next. That is
  // correct behaviour for a transcript, but the overlay must not treat it as
  // "the question ended" — a speaker pausing mid-sentence would otherwise have
  // everything before the pause replaced by the few words after it. So finals
  // accumulate here and are only cleared by an explicit user action.
  const committedRef = useRef("");
  // Id of the transcript segment currently mid-utterance (a partial has been
  // seen but its final hasn't landed yet). STT finalizes a segment shortly
  // after speech ends, which can race the user tapping Ask AI: the partial's
  // text is already reflected in `question` (and thus in what gets sent),
  // but the final for that same segment can still arrive afterward. Without
  // tracking this, that late final would land in the freshly-cleared buffer
  // and make the just-asked question reappear in the field.
  const pendingPartialIdRef = useRef<string | null>(null);
  // Segment id whose upcoming final_text should be dropped rather than
  // appended, because it was already folded into a question that was just
  // sent (see askAI). Cleared once that final arrives (or a new question
  // starts).
  const suppressFinalIdRef = useRef<string | null>(null);
  const sessionStartedAtRef = useRef(Date.now());
  // Mirrors `busy` for the event listeners, which close over stale state
  // otherwise. Answer deltas must keep landing regardless of re-renders.
  const busyRef = useRef(false);
  const hintTimerRef = useRef<number | null>(null);
  // Auto AI: debounce timer that fires askAI() once the interviewer has
  // stopped talking for AUTO_AI_SILENCE_MS. Lives in a ref (not state) since
  // it's set/cleared from the transcript listener, which must not re-subscribe
  // on every keystroke-equivalent state change.
  const autoAiTimerRef = useRef<number | null>(null);
  // askAI/settings change identity on every render; mirrored into refs so the
  // transcript listener (subscribed once, on mount) always calls the latest
  // version instead of one captured at effect-setup time.
  const askAIRef = useRef<() => void>(() => {});
  const autoAIEnabledRef = useRef(false);
  // Id of the turn currently receiving answer-delta/answer-complete events —
  // the reveal ticker below only ever touches this turn.
  const currentTurnIdRef = useRef<string | null>(null);
  // Per-turn reveal state, keyed by turn id. `full` accumulates every delta
  // (and is topped up by the authoritative answer-complete payload) as fast
  // as events arrive; `shown` trails behind it and is drained at a steady
  // pace by the ticker effect below. This decouples "text received" from
  // "text displayed": whether the backend/network delivers real token-by-
  // token deltas or the whole answer in one late burst, the overlay always
  // reveals it as a smooth word-by-word typing effect instead of slamming
  // the full answer onto screen at once. `done` marks that answer-complete
  // has landed for this turn, so the ticker knows there's nothing more to
  // wait for once `shown` catches up to `full`.
  const revealRef = useRef<Map<string, { full: string; shown: number; done: boolean }>>(new Map());

  useEffect(
    () => () => {
      if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    saveOverlaySettings(settings);
  }, [settings]);

  useEffect(() => {
    autoAIEnabledRef.current = settings.autoAI;
    // Turning Auto AI off mid-pause must cancel any timer already counting
    // down — otherwise a question could still auto-send just after the user
    // switched it off.
    if (!settings.autoAI && autoAiTimerRef.current) {
      window.clearTimeout(autoAiTimerRef.current);
      autoAiTimerRef.current = null;
    }
  }, [settings.autoAI]);

  // Live transcript feed: reuse the exact same "transcript:update" event the
  // main window listens to (see App.tsx) — both windows share the same Rust
  // backend process/state, so no separate capture pipeline is needed here.
  //
  // This behaves like continuous dictation. There is deliberately no question
  // detection, no sentence-end detection, and nothing that clears the field on
  // silence: finalized utterances are appended to a running buffer and only an
  // explicit "Ask AI" (or the user editing/clearing it) ends the question.
  //
  // Auto AI (when enabled in settings) layers a silence-based heuristic on
  // top of this same buffer rather than replacing it: any new partial/final
  // text always resets the debounce timer below, so a mid-question pause
  // never gets treated as "done" — only a real gap in speech does, the same
  // signal a human listener would use. How long that gap needs to be is
  // itself adaptive: classifyQuestionCompleteness() judges from the buffered
  // text's own wording whether it reads as a finished question or a
  // trailing clause, so a genuine pause mid-question ("I used this
  // because...") gets more room to continue before Auto AI gives up and
  // sends it, while a question that already reads as complete fires quickly.
  useEffect(() => {
    const clearAutoAiTimer = () => {
      if (autoAiTimerRef.current) {
        window.clearTimeout(autoAiTimerRef.current);
        autoAiTimerRef.current = null;
      }
    };

    const armAutoAiTimer = () => {
      clearAutoAiTimer();
      if (!autoAIEnabledRef.current || busyRef.current) return;
      const completeness = classifyQuestionCompleteness(committedRef.current);
      const delay =
        completeness === "complete" ? AUTO_AI_SILENCE_MS_COMPLETE : AUTO_AI_SILENCE_MS_INCOMPLETE;
      autoAiTimerRef.current = window.setTimeout(() => {
        autoAiTimerRef.current = null;
        askAIRef.current();
      }, delay);
    };

    const unlistenTranscript = listen<TranscriptSegment>("transcript:update", (event) => {
      const segment = event.payload;
      if (segment.source !== "SYSTEM_AUDIO") return;
      // While an answer is streaming, keep buffering finals silently: the
      // interviewer may already be asking the next question. They land in the
      // field, not in the answer that's still arriving.
      if (segment.final_text) {
        if (suppressFinalIdRef.current === segment.id) {
          // This final belongs to the utterance that was already sent as
          // part of the previous question (via its partial text) — drop it
          // instead of letting it repopulate the now-cleared field.
          suppressFinalIdRef.current = null;
          if (pendingPartialIdRef.current === segment.id) pendingPartialIdRef.current = null;
          return;
        }
        if (pendingPartialIdRef.current === segment.id) pendingPartialIdRef.current = null;
        committedRef.current = joinSpeech(committedRef.current, segment.final_text);
        setQuestion(committedRef.current);
        armAutoAiTimer();
      } else if (segment.partial_text) {
        pendingPartialIdRef.current = segment.id;
        setQuestion(joinSpeech(committedRef.current, segment.partial_text));
        // Still speaking — any timer counting down from an earlier final must
        // not fire mid-sentence.
        clearAutoAiTimer();
      }
    });

    // Deltas always belong to the last turn — it is the only one that can be
    // pending, because Ask AI is disabled until the previous answer completes.
    // They only feed the reveal buffer here; the ticker effect below is what
    // actually paints them into `turns`, at a steady pace.
    const unlistenDelta = listen<string>("interview-mode:answer-delta", (event) => {
      const id = currentTurnIdRef.current;
      if (!id) return;
      const entry = revealRef.current.get(id);
      if (!entry || entry.done) return;
      entry.full += event.payload;
    });

    const unlistenComplete = listen<string>("interview-mode:answer-complete", (event) => {
      const id = currentTurnIdRef.current;
      if (id) {
        const entry = revealRef.current.get(id) ?? { full: "", shown: 0, done: false };
        // Prefer the completed answer from the event: it is authoritative,
        // where the accumulated deltas could have dropped one.
        if (event.payload && event.payload.length > entry.full.length) entry.full = event.payload;
        entry.done = true;
        revealRef.current.set(id, entry);
      }
      // The turn itself is only marked non-pending once the reveal ticker
      // finishes draining it (see below) — busy/pending stay in sync with
      // what's actually on screen, not with when bytes arrived.
    });

    return () => {
      unlistenTranscript.then((f) => f());
      unlistenDelta.then((f) => f());
      unlistenComplete.then((f) => f());
      clearAutoAiTimer();
    };
  }, []);

  // Reveal ticker: drains the current turn's reveal buffer (see
  // `revealRef` above) at a steady pace instead of dumping newly-received
  // text onto screen the instant it arrives. Advances one word at a time in
  // the common case; when a lot of unrevealed text has piled up (e.g. the
  // backend delivered most of the answer in one late burst), it reveals
  // proportionally more words per tick so a long buffered answer still
  // finishes in a reasonable time instead of visibly crawling.
  useEffect(() => {
    const TICK_MS = 30;
    const advance = (full: string, shown: number): number => {
      const remaining = full.length - shown;
      if (remaining <= 0) return shown;
      const wordsThisTick = 1 + Math.floor(remaining / 150);
      let pos = shown;
      for (let i = 0; i < wordsThisTick; i++) {
        const nextSpace = full.indexOf(" ", pos);
        if (nextSpace === -1) {
          pos = full.length;
          break;
        }
        pos = nextSpace + 1;
      }
      return pos;
    };

    const id = window.setInterval(() => {
      const turnId = currentTurnIdRef.current;
      if (!turnId) return;
      const entry = revealRef.current.get(turnId);
      if (!entry) return;

      if (entry.shown >= entry.full.length) {
        if (!entry.done) return;
        setTurns((prev) => {
          const idx = prev.findIndex((t) => t.id === turnId);
          if (idx === -1 || !prev[idx].pending) return prev;
          const next = [...prev];
          next[idx] = { ...next[idx], answer: entry.full, pending: false };
          return next;
        });
        if (currentTurnIdRef.current === turnId) currentTurnIdRef.current = null;
        busyRef.current = false;
        setBusy(false);
        return;
      }

      entry.shown = advance(entry.full, entry.shown);
      setTurns((prev) => {
        const idx = prev.findIndex((t) => t.id === turnId);
        if (idx === -1 || !prev[idx].pending) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], answer: entry.full.slice(0, entry.shown) };
        return next;
      });
    }, TICK_MS);

    return () => window.clearInterval(id);
  }, []);

  // Live countdown: fetch the plan balance once per session (on mount, and
  // again whenever the reused overlay window resets for a new interview —
  // see the overlay:reset-session listener below), then tick it down every
  // second locally.
  useEffect(() => {
    let cancelled = false;
    getEntitlement()
      .then((info) => !cancelled && setRemainingSecondsAtStart(Math.round(info.remainingMinutes * 60)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - sessionStartedAtRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    invoke<OverlayCaptureStatus>("show_interview_overlay")
      .then((status) => {
        setCaptureExcluded(status.excluded);
        // show_interview_overlay always turns protection ON for a
        // brand-new window (it has no way to know a returning user
        // previously chose to leave it off in Settings — see
        // OverlaySettingsPanel's capture-protection checkbox). Reconcile
        // here the same way the size fraction below does.
        if (!settings.captureProtection) {
          invoke<OverlayCaptureStatus>("set_overlay_capture_exclusion", { enabled: false })
            .then((s) => setCaptureExcluded(s.excluded))
            .catch(() => {});
        }
      })
      .catch((e) => setError(String(e)));

    // A brand-new overlay window is created at the Rust-side default size
    // (interview_mode::window::DEFAULT_SIZE_FRACTION), which does not know
    // about a returning user's saved Small/Medium/Large choice. Apply it here
    // so that choice takes effect immediately rather than only after the user
    // next opens Settings and touches the size control themselves.
    invoke("resize_interview_overlay", { fraction: SIZE_FRACTIONS[settings.size] }).catch(() => {
      // Best-effort — the window simply stays at its default size.
    });

    // Interview Mode can now be opened without having started a recording
    // first (see App.tsx), but the live transcript this overlay listens to
    // only exists once WASAPI+STT capture is actually running. Start it here
    // if it isn't already active so "Listening" is never just a silent
    // no-op; "capture already running" from a prior Start Recording click is
    // the one expected/harmless failure — anything else (e.g. no audio
    // device) must surface, or the overlay would sit on "Waiting for the
    // interviewer to speak…" forever with no explanation.
    invoke("start_system_audio_capture")
      .then(() => setCaptureActive(true))
      .catch((e) => {
        if (String(e) !== "capture already running") {
          setError(`Could not start audio capture: ${String(e)}`);
        } else {
          // A session was already started elsewhere (e.g. InterviewSetup's
          // own call, which this effect always races against) — that
          // session is genuinely active, so this is not a failure.
          setCaptureActive(true);
        }
      });
  }, []);

  // The overlay window is *reused* across interviews, not recreated (see
  // overlay_window.rs's show_overlay_window) — its WebView2 process/DOM
  // stays alive while hidden between "Close" and the next "Start". Without
  // this, reopening for a brand-new interview would still show the
  // previous session's whole conversation the instant the window
  // reappears, since none of this component's state resets on its own.
  // The Rust side emits this right before re-showing an existing window.
  useEffect(() => {
    const unlistenReset = listen("overlay:reset-session", () => {
      // Re-read settings from localStorage — the overlay window is reused
      // (see the comment above), so its React state otherwise still holds
      // whatever role/company were current the *first* time this window was
      // created, missing anything set from the Start dropdown just before
      // this specific interview (see App.tsx's start-details popover).
      setSettings(loadOverlaySettings());
      setTurns([]);
      setQuestion("");
      setBusy(false);
      setError(null);
      setConfirmingClose(false);
      setSettingsOpen(false);
      setMuted(false);
      committedRef.current = "";
      pendingPartialIdRef.current = null;
      suppressFinalIdRef.current = null;
      busyRef.current = false;
      sessionStartedAtRef.current = Date.now();
      setElapsedSeconds(0);
      getEntitlement()
        .then((info) => setRemainingSecondsAtStart(Math.round(info.remainingMinutes * 60)))
        .catch(() => {});
      // Re-showing an *existing* overlay window also always turns capture
      // protection back ON on the Rust side (overlay_window.rs's
      // show_overlay_window) — reconcile with a returning user's saved
      // preference the same way the very-first-open effect above does, so
      // choosing "off" once doesn't get silently reset on the next reopen.
      if (!settingsRef.current.captureProtection) {
        invoke<OverlayCaptureStatus>("set_overlay_capture_exclusion", { enabled: false })
          .then((s) => setCaptureExcluded(s.excluded))
          .catch(() => {});
      }
    });
    return () => {
      unlistenReset.then((f) => f());
    };
  }, []);

  // Follow the conversation as it grows, the way a chat window does.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, question]);

  // Shared between `askAI` and `analyzeScreen` — both send the same
  // answer-shaping options to their respective backend commands.
  const buildAskOptions = useCallback(() => {
    const chosenProvider = loadLlmProvider();
    return {
      answerLength: settings.answerLength,
      responseStyle: settings.responseStyle,
      role: settings.role.trim() || null,
      company: settings.company.trim() || null,
      jobDescription: settings.jobDescription.trim() || null,
      englishLevel: settings.englishLevel,
      humanization: settings.humanization,
      // DeepSeek isn't implemented backend-side yet (see
      // llmProviderSetting.ts) — the header dropdown keeps it disabled, so
      // only "anthropic"/"openai"/"gemini" ever actually reach here in
      // practice, but guard anyway rather than send an unsupported value.
      llmProvider:
        chosenProvider === "anthropic" || chosenProvider === "openai" || chosenProvider === "gemini"
          ? chosenProvider
          : null,
    };
  }, [settings]);

  const askAI = useCallback(async () => {
    const trimmed = question.trim();
    if (!trimmed || busyRef.current) return;

    setError(null);
    // The question moves into the conversation and the buffer resets, so
    // anything said from here starts the next question instead of being
    // appended onto one already sent.
    const turn: Turn = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      question: trimmed,
      answer: "",
      pending: true,
      askedAt: Date.now(),
    };
    setTurns((prev) => [...prev, turn]);
    setViewIndex(null);
    setQuestion("");
    committedRef.current = "";
    currentTurnIdRef.current = turn.id;
    revealRef.current.set(turn.id, { full: "", shown: 0, done: false });
    // If the interviewer was still mid-utterance when Ask AI was pressed,
    // its text already made it into `trimmed` via the live partial — the
    // final that STT emits for that same segment a moment later must be
    // dropped, not appended to the fresh buffer for the next question.
    suppressFinalIdRef.current = pendingPartialIdRef.current;
    busyRef.current = true;
    setBusy(true);

    // Prior turns only — the one just pushed is the current question, and
    // completed turns are the only ones worth replaying.
    const history = turns
      .filter((t) => !t.pending && t.answer.trim() && !t.failed)
      .map((t) => ({ question: t.question, answer: t.answer }));

    try {
      await invoke<string>("ask_interview_question", {
        question: trimmed,
        history,
        options: buildAskOptions(),
      });
    } catch (e) {
      setError(String(e));
      // Keep the question visible in the conversation and mark it failed,
      // rather than silently dropping what the interviewer asked.
      setTurns((prev) =>
        prev.map((t) => (t.id === turn.id ? { ...t, pending: false, failed: true } : t)),
      );
      if (currentTurnIdRef.current === turn.id) currentTurnIdRef.current = null;
      revealRef.current.delete(turn.id);
      busyRef.current = false;
      setBusy(false);
    }
  }, [question, turns, buildAskOptions]);

  useEffect(() => {
    askAIRef.current = askAI;
  }, [askAI]);

  // Captures the primary screen and asks the LLM to identify/solve whatever
  // is shown (a coding problem, a diagram, written questions, etc.) — same
  // streamed-turn shape as askAI, just without a transcribed question.
  const analyzeScreen = useCallback(async () => {
    if (busyRef.current) return;

    setError(null);
    const turn: Turn = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      question: ANALYZE_SCREEN_QUESTION_LABEL,
      answer: "",
      pending: true,
      askedAt: Date.now(),
    };
    setTurns((prev) => [...prev, turn]);
    setViewIndex(null);
    currentTurnIdRef.current = turn.id;
    revealRef.current.set(turn.id, { full: "", shown: 0, done: false });
    busyRef.current = true;
    setBusy(true);

    const history = turns
      .filter((t) => !t.pending && t.answer.trim() && !t.failed)
      .map((t) => ({ question: t.question, answer: t.answer }));

    try {
      await invoke<string>("analyze_screen_question", {
        history,
        options: buildAskOptions(),
      });
    } catch (e) {
      setError(String(e));
      setTurns((prev) =>
        prev.map((t) => (t.id === turn.id ? { ...t, pending: false, failed: true } : t)),
      );
      if (currentTurnIdRef.current === turn.id) currentTurnIdRef.current = null;
      revealRef.current.delete(turn.id);
      busyRef.current = false;
      setBusy(false);
    }
  }, [turns, buildAskOptions]);

  // Sends a manually typed message in Chat mode — independent of the live
  // transcript (`question`/committedRef), so switching into Chat mode never
  // disturbs STT dictation running in the background. Reuses the same
  // backend command and conversation history as askAI; the only difference
  // is where the outgoing text comes from.
  const sendChat = useCallback(async () => {
    const trimmed = chatDraft.trim();
    if (!trimmed || busyRef.current) return;

    setError(null);
    const turn: Turn = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      question: trimmed,
      answer: "",
      pending: true,
      askedAt: Date.now(),
    };
    setTurns((prev) => [...prev, turn]);
    setViewIndex(null);
    setChatDraft("");
    currentTurnIdRef.current = turn.id;
    revealRef.current.set(turn.id, { full: "", shown: 0, done: false });
    busyRef.current = true;
    setBusy(true);

    const history = turns
      .filter((t) => !t.pending && t.answer.trim() && !t.failed)
      .map((t) => ({ question: t.question, answer: t.answer }));

    try {
      await invoke<string>("ask_interview_question", {
        question: trimmed,
        history,
        options: buildAskOptions(),
      });
    } catch (e) {
      setError(String(e));
      setTurns((prev) =>
        prev.map((t) => (t.id === turn.id ? { ...t, pending: false, failed: true } : t)),
      );
      if (currentTurnIdRef.current === turn.id) currentTurnIdRef.current = null;
      revealRef.current.delete(turn.id);
      busyRef.current = false;
      setBusy(false);
    }
  }, [chatDraft, turns, buildAskOptions]);

  const handleChatKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    },
    [sendChat],
  );

  const toggleFeedback = useCallback((turnId: string, reaction: "up" | "down") => {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId ? { ...t, feedback: t.feedback === reaction ? null : reaction } : t,
      ),
    );
  }, []);

  const copyAnswer = useCallback((answer: string) => {
    navigator.clipboard?.writeText(answer).catch(() => {});
  }, []);

  // Single-turn panel navigation (⌘←/⌘→ in the reference layout) — pages the
  // displayed turn without touching `turns` itself.
  const goPrevTurn = useCallback(() => {
    setViewIndex((v) => {
      const current = v ?? turns.length - 1;
      return Math.max(0, current - 1);
    });
  }, [turns.length]);

  const goNextTurn = useCallback(() => {
    setViewIndex((v) => {
      const current = v ?? turns.length - 1;
      return Math.min(turns.length - 1, current + 1);
    });
  }, [turns.length]);

  // Clears the whole conversation (the panel's own Clear), distinct from the
  // transcript/chat-draft Clear in the compose bar below.
  const clearConversation = useCallback(() => {
    if (busyRef.current) return;
    setTurns([]);
    setViewIndex(null);
  }, []);

  // Clears whichever buffer is currently live in the compose bar — the
  // dictated transcript normally, or the chat draft while in Chat mode.
  const clearComposeBuffer = useCallback(() => {
    if (chatMode) {
      setChatDraft("");
    } else {
      setQuestion("");
      committedRef.current = "";
    }
  }, [chatMode]);

  // Resize icon — cycles the overlay through its three preset sizes (see
  // SIZE_FRACTIONS) and actually resizes the window itself; nothing else
  // reacts to `settings.size` changes to do that on its own (the mount-time
  // effect that calls resize_interview_overlay only ever runs once).
  const cycleSize = useCallback(() => {
    setSettings((prev) => {
      const idx = SIZE_ORDER.indexOf(prev.size);
      const nextSize = SIZE_ORDER[(idx + 1) % SIZE_ORDER.length];
      invoke("resize_interview_overlay", { fraction: SIZE_FRACTIONS[nextSize] }).catch(() => {});
      return { ...prev, size: nextSize };
    });
  }, []);

  // Archives the Q&A turns so far as one history entry, then hides the
  // overlay. Turns still pending/failed are skipped — only completed
  // exchanges are worth keeping. An empty result (nothing ever asked) is a
  // no-op on the Rust side, so opening and closing without using it never
  // clutters history.
  //
  // The overlay window itself is never destroyed between interviews — Rust's
  // show_overlay_window reuses the existing webview (see interview_mode/
  // window.rs) purely for speed, so this component never remounts and its
  // React state would otherwise survive from one interview into the next.
  // Clearing turns/question/committedRef/sessionStartedAtRef here, right
  // after archiving, is what makes the *next* "Start Interview" actually
  // start blank instead of resuming the just-archived conversation.
  const closeOverlay = useCallback(async () => {
    setConfirmingClose(false);
    const completed = turns
      .filter((t) => !t.pending && !t.failed && t.answer.trim())
      .map((t) => ({ question: t.question, answer: t.answer, askedAtMs: t.askedAt }));
    try {
      await invoke("archive_interview_session", {
        startedAtMs: sessionStartedAtRef.current,
        role: settings.role.trim() || null,
        company: settings.company.trim() || null,
        turns: completed,
      });
    } catch (e) {
      console.error("Failed to archive interview session:", e);
    }

    if (autoAiTimerRef.current) {
      window.clearTimeout(autoAiTimerRef.current);
      autoAiTimerRef.current = null;
    }
    committedRef.current = "";
    pendingPartialIdRef.current = null;
    suppressFinalIdRef.current = null;
    sessionStartedAtRef.current = Date.now();
    setTurns([]);
    setQuestion("");
    setError(null);
    busyRef.current = false;
    setBusy(false);

    invoke("hide_interview_overlay").catch(() => overlayWindow.hide());
  }, [turns, settings.role, settings.company]);

  // Entry point for both the End button and Escape: conversations with at least
  // one exchange ask for confirmation first (closing mid-interview is easy to
  // trigger by accident), while an empty session just closes immediately —
  // there's nothing to lose by skipping the prompt.
  const toggleMute = useCallback(async () => {
    if (muteBusy || !captureActive) return;
    setMuteBusy(true);
    setError(null);
    try {
      await invoke(muted ? "resume_recording" : "pause_recording");
      setMuted((v) => !v);
    } catch (e) {
      setError(String(e));
    } finally {
      setMuteBusy(false);
    }
  }, [muted, muteBusy, captureActive]);

  const requestClose = useCallback(() => {
    const hasConversation = turns.some((t) => !t.pending && t.answer.trim());
    if (hasConversation) {
      setConfirmingClose(true);
    } else {
      closeOverlay();
    }
  }, [turns, closeOverlay]);

  // Grows the textarea to fit its content, up to MAX_QUESTION_INPUT_PX — past
  // that it scrolls internally instead of continuing to eat the conversation
  // area above it. Plain CSS can't do this (a textarea's height doesn't track
  // its own content), so height is measured and set imperatively whenever the
  // text changes, including from STT — a long dictated question needs this
  // exactly as much as one the user typed.
  const autoGrow = useCallback(() => {
    const el = questionRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_QUESTION_INPUT_PX)}px`;
  }, []);

  const handleQuestionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      // Adopt the user's text as the new buffer. Without this, a later
      // utterance would append onto the pre-edit text and silently undo their
      // correction.
      committedRef.current = e.target.value;
      setQuestion(e.target.value);
    },
    [],
  );

  // Runs after every render where `question` changed — covers typing, STT
  // partials/finals, and the reset to "" after Ask AI — rather than being
  // wired into each of those call sites individually.
  useEffect(() => {
    autoGrow();
  }, [question, autoGrow]);

  const handleQuestionKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        askAI();
      }
      // Shift+Enter falls through to the textarea's default behavior and
      // inserts a newline.
    },
    [askAI],
  );

  const handleOpacityChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, Number(e.target.value)));
    setSettings((prev) => ({ ...prev, opacity: next }));
    // Show the percentage while dragging, then get out of the way.
    setOpacityHint(true);
    if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current);
    hintTimerRef.current = window.setTimeout(() => setOpacityHint(false), 1000);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (confirmingClose) {
        if (e.key === "Escape") setConfirmingClose(false);
        return;
      }
      if (settingsOpen) {
        if (e.key === "Escape") setSettingsOpen(false);
        return;
      }
      // Ctrl-chord shortcuts work from anywhere in the overlay, including
      // while a textarea has focus — Ctrl+Enter/Ctrl+Shift+Enter/
      // Ctrl+Shift+C are deliberately distinct from plain Enter (which the
      // transcript/chat textareas already handle themselves) so they never
      // collide with normal typing.
      if (e.ctrlKey && !e.altKey && e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          analyzeScreen();
        } else {
          askAI();
        }
        return;
      }
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        setChatMode((v) => !v);
        return;
      }
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        goPrevTurn();
        return;
      }
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        goNextTurn();
        return;
      }

      // The textarea has its own Enter/Shift+Enter handling above; this
      // top-level listener only needs to cover ESC (hide) globally and ENTER
      // when focus is somewhere else in the overlay.
      const activeIsTextarea = document.activeElement === questionRef.current;
      if (e.key === "Enter" && !activeIsTextarea) {
        e.preventDefault();
        askAI();
      } else if (e.key === "Escape") {
        requestClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [askAI, analyzeScreen, goPrevTurn, goNextTurn, settingsOpen, confirmingClose, requestClose]);

  const overlayStyle: React.CSSProperties = {
    fontSize: `${settings.fontSize}px`,
    // Applied to the panel background rather than the whole element, so text
    // stays fully legible while the window itself reads as translucent.
    // Forced fully opaque while the settings panel is open — the opacity
    // slider is a conversation-legibility knob, not something that should
    // also make its own controls hard to see while you're adjusting them.
    ["--overlay-alpha" as string]: settingsOpen ? 1 : settings.opacity,
  };

  const hasConversation = turns.length > 0;
  const displayIndex = turns.length === 0 ? -1 : Math.min(viewIndex ?? turns.length - 1, turns.length - 1);
  const activeTurn = displayIndex >= 0 ? turns[displayIndex] : null;
  const opacityPercent = Math.round(settings.opacity * 100);

  return (
    <div
      className={`overlay-root density-${settings.density} size-${settings.size}`}
      style={overlayStyle}
    >
      {/* Row A — primary actions, styled as a pill toolbar (matches the
          reference layout: Answer / Screenshot / Chat on the left, End on
          the right). "deep" so the whole bar drags outside the pills
          themselves — Tauri's drag script already treats BUTTON as
          clickable and blocks dragging for it. */}
      <div className="overlay-header overlay-action-bar" data-tauri-drag-region="deep">
        {/* Mic + system audio share one underlying capture/mute pipeline
            (see toggleMute/pause_recording — there's no separate on/off for
            each source), so both are real buttons wired to the same toggle;
            a lit red dot means that source is actually feeding the
            transcript right now. This is also the overlay's only mute
            control — the transcript bar used to have its own second mic
            icon here, which was just a duplicate of this one. */}
        <button
          type="button"
          className="overlay-status-icon"
          onClick={toggleMute}
          disabled={!captureActive || muteBusy}
          data-tooltip={muted ? "Unmute — resume transcribing" : "Mute — pause transcribing"}
        >
          {muted ? <MicOffIcon size={13} /> : <MicIcon size={13} />}
          {captureActive && !muted && <span className="overlay-status-dot" />}
        </button>
        <button
          type="button"
          className="overlay-status-icon"
          onClick={toggleMute}
          disabled={!captureActive || muteBusy}
          data-tooltip={muted ? "Unmute — resume transcribing" : "Mute — pause transcribing"}
        >
          <SpeakerIcon size={13} />
          {captureActive && !muted && <span className="overlay-status-dot" />}
        </button>
        <button
          type="button"
          className="overlay-pill-button"
          onClick={askAI}
          disabled={!question.trim() || busy}
          data-tooltip="Answer (Ctrl+Enter)"
        >
          Answer
        </button>
        <button
          type="button"
          className="overlay-pill-button"
          onClick={analyzeScreen}
          disabled={busy}
          data-tooltip="Analyze what's on my screen (Ctrl+Shift+Enter)"
        >
          Analyze Screen
        </button>
        {/* Auto AI toggle — replaces the Chat button here; the manual typed
            follow-up it used to open is still reachable via Ctrl+Shift+C,
            just without a dedicated pill in the primary row. */}
        <button
          type="button"
          className={`overlay-pill-button${settings.autoAI ? " on" : ""}`}
          onClick={() => setSettings((prev) => ({ ...prev, autoAI: !prev.autoAI }))}
          data-tooltip={
            settings.autoAI
              ? "Auto Answer is on — questions send automatically when the interviewer stops talking"
              : "Auto Answer is off — use Answer or Enter to send"
          }
        >
          Auto Answer
        </button>
        {remainingSecondsAtStart !== null && (
          <span
            className="overlay-time-left"
            style={{ opacity: 0.7, fontVariantNumeric: "tabular-nums" }}
            data-tooltip="Time remaining on your plan this session"
          >
            {formatCountdown(Math.max(0, remainingSecondsAtStart - elapsedSeconds))} left
          </span>
        )}
        <div className="overlay-action-bar-spacer" />
        {/* Not a <button> — the whole bar is already the drag handle (see
            data-tauri-drag-region="deep" above); a real button here would
            do nothing on click while also *blocking* the drag gesture at
            that exact spot (Tauri's drag script excludes interactive
            elements from dragging). This is purely the visual "you can drag
            from here" affordance. */}
        <span className="overlay-move-affordance" data-tooltip="Drag anywhere on this bar to move">
          <MoveIcon />
        </span>
        {/* Safe inside the header's drag region without any extra handling:
            Tauri's drag script treats INPUT as clickable and blocks dragging
            for it (see tauri/src/window/scripts/drag.js). Do NOT wrap this in
            a <label> or give it a data-tauri-drag-region attribute — either
            would hand the gesture back to the window and make the bar
            undraggable. */}
        <input
          type="range"
          className="overlay-opacity-slider"
          min={OPACITY_MIN}
          max={OPACITY_MAX}
          step={0.01}
          value={settings.opacity}
          onChange={handleOpacityChange}
          aria-label="Overlay opacity"
          data-tooltip={`Opacity — ${opacityPercent}%`}
        />
        {opacityHint && <span className="overlay-opacity-readout">{opacityPercent}%</span>}
        <button
          type="button"
          className="overlay-icon-button"
          onClick={cycleSize}
          data-tooltip={`Resize (currently ${settings.size})`}
        >
          <ResizeIcon />
        </button>
        <button
          type="button"
          className={`overlay-icon-button${moreOpen ? " on" : ""}`}
          onClick={() => setMoreOpen((v) => !v)}
          data-tooltip="More"
        >
          <MoreVerticalIcon />
        </button>
        <button
          type="button"
          className="overlay-pill-button end"
          onClick={requestClose}
          data-tooltip="End interview (Esc)"
        >
          End
        </button>
      </div>

      {/* Row B — status + Auto AI/opacity/full-settings, tucked behind "⋮"
          (More) instead of permanently on screen, matching the reference's
          minimal default chrome. */}
      {moreOpen && (
        <div className="overlay-header overlay-status-bar" data-tauri-drag-region="deep">
          <div className="overlay-title">
            {/* While adjusting, the title doubles as the readout — the
                change itself can be hard to judge against a dark desktop,
                and this avoids spending permanent header space on a number.
                Before capture is confirmed active, this says "Starting…"
                rather than claiming "Listening" while audio/STT may still be
                initializing (or may have failed — see the error banner
                below). */}
            {opacityHint
              ? `Opacity ${opacityPercent}%`
              : busy
                ? "Answering…"
                : muted
                  ? "Muted"
                  : captureActive
                    ? "Listening"
                    : "Starting…"}
          </div>

          <div className="overlay-header-actions">
            {/* Time-left and the Auto Answer toggle both moved to the main
                action bar above — not duplicated here. */}
            <button
              className="overlay-icon-button"
              onClick={() => setSettingsOpen((v) => !v)}
              data-tooltip="Settings"
            >
              <GearIcon />
            </button>
          </div>
        </div>
      )}

      {/* Screen-capture exclusion (SetWindowDisplayAffinity/
          WDA_EXCLUDEFROMCAPTURE) can fail — older Windows builds don't
          support it, and the OS call can simply error. When that happens
          this window IS visible to screen share/recording, which defeats
          the whole point of a private overlay, so this can't be a detail
          tucked away in Settings (see OverlaySettingsPanel's "Screen Capture
          Protection" row) — it has to stay on screen for the entire
          session, not just flash once, since the interviewer's screen share
          might start at any point after this. Rendered outside the
          settings/confirm branches below so it persists across all of the
          overlay's views. */}
      {captureExcluded === false && (
        <p className="overlay-capture-warning">
          ⚠ Screen capture protection unavailable — this window may be visible if you share your screen
        </p>
      )}

      {confirmingClose ? (
        <div className="overlay-confirm-close">
          <p className="overlay-confirm-close-title">Is the interview over?</p>
          <p className="overlay-confirm-close-body">
            Closing will save this conversation to your interview history.
          </p>
          <div className="overlay-confirm-close-actions">
            <button className="overlay-text-button" onClick={() => setConfirmingClose(false)}>
              Keep going
            </button>
            <button className="overlay-text-button primary" onClick={closeOverlay}>
              Yes, end interview
            </button>
          </div>
        </div>
      ) : settingsOpen ? (
        <OverlaySettingsPanel
          settings={settings}
          onChange={setSettings}
          onClose={() => setSettingsOpen(false)}
          captureExcluded={captureExcluded}
          onCaptureExcludedChange={setCaptureExcluded}
        />
      ) : (
        <>
          {/* Transcript/chat bar — its own rounded island, sitting between
              the action bar and the answer panel. */}
          {chatMode ? (
            <div className="overlay-header overlay-transcript-bar overlay-chat-compose">
              <AudioLevelBars active={sttSpeaking && !busy} />
              <textarea
                className="overlay-question-input"
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                onKeyDown={handleChatKeyDown}
                placeholder="Type a follow-up…"
                rows={1}
                autoFocus
              />
              <button
                type="button"
                className="overlay-pill-button"
                onClick={clearComposeBuffer}
                disabled={!chatDraft.trim()}
                data-tooltip="Clear (Ctrl+Shift+Backspace)"
              >
                Clear
              </button>
              <button
                className="overlay-icon-button"
                onClick={sendChat}
                disabled={!chatDraft.trim() || busy}
                data-tooltip="Send (Enter)"
              >
                <SendIcon />
              </button>
            </div>
          ) : (
            <div className="overlay-header overlay-transcript-bar">
              <AudioLevelBars active={sttSpeaking && !busy} />
              <textarea
                ref={questionRef}
                className="overlay-question-input"
                value={question}
                onChange={handleQuestionChange}
                onKeyDown={handleQuestionKeyDown}
                placeholder={hasConversation ? "Next question…" : "Waiting for the interviewer to speak…"}
                rows={1}
              />
              <button
                type="button"
                className="overlay-pill-button"
                onClick={clearComposeBuffer}
                disabled={!question.trim()}
                data-tooltip="Clear (Ctrl+Shift+Backspace)"
              >
                Clear
              </button>
            </div>
          )}

          {/* Main panel — a single Q&A card with ⌘←/⌘→-style paging through
              the conversation, rather than one long scrolling list. Toolbar
              + body share one island (no gap/shadow between them); the
              wrapper below is what actually carries the panel's background,
              radius and shadow. */}
          <div className="overlay-panel">
          <div className="overlay-header overlay-panel-toolbar" data-tauri-drag-region="deep">
            <button
              type="button"
              className="overlay-icon-button"
              onClick={goPrevTurn}
              disabled={displayIndex <= 0}
              data-tooltip="Previous question (Ctrl+Left)"
            >
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              className="overlay-icon-button"
              onClick={goNextTurn}
              disabled={displayIndex < 0 || displayIndex >= turns.length - 1}
              data-tooltip="Next question (Ctrl+Right)"
            >
              <ChevronRightIcon />
            </button>
            <div className="overlay-action-bar-spacer" />
            <button
              type="button"
              className="overlay-pill-button"
              onClick={clearConversation}
              disabled={!hasConversation || busy}
              data-tooltip="Clear the whole conversation"
            >
              Clear
            </button>
          </div>

          <div className="overlay-chat" ref={scrollRef}>
            {!activeTurn ? (
              <p className="overlay-empty">Waiting for the interviewer to speak…</p>
            ) : (
              <div className="chat-turn">
                <div className="chat-card-label question">
                  <span className="chat-card-icon">
                    <MessageIcon size={13} />
                  </span>
                  <span>Question:</span>
                  <span className="chat-card-question-text">{activeTurn.question}</span>
                  <button
                    type="button"
                    className="chat-copy-button"
                    onClick={() => copyAnswer(activeTurn.answer)}
                    disabled={!activeTurn.answer}
                    data-tooltip="Copy answer"
                  >
                    <CopyIcon size={13} />
                  </button>
                </div>
                <div className={`chat-answer-card${activeTurn.failed ? " failed" : ""}`}>
                  <div className="chat-card-label answer">
                    <span className="chat-card-icon">
                      <StarIcon size={13} />
                    </span>
                    <span>Answer:</span>
                    {!activeTurn.pending && (
                      <span className="chat-answer-timestamp">
                        {formatTimestamp(activeTurn.askedAt)}
                      </span>
                    )}
                  </div>
                  {activeTurn.answer ? (
                    <div className="chat-text chat-markdown">
                      <ReactMarkdown components={{ code: MarkdownCode }}>{activeTurn.answer}</ReactMarkdown>
                    </div>
                  ) : activeTurn.failed ? (
                    <p className="chat-text muted">Couldn't get an answer.</p>
                  ) : (
                    <p className="chat-text muted thinking">Thinking…</p>
                  )}
                  {!activeTurn.pending && (
                    <div className="chat-answer-footer">
                      <span className="chat-answer-timestamp">
                        Answer · {formatTimestamp(activeTurn.askedAt)}
                      </span>
                      <div className="chat-feedback">
                        <button
                          type="button"
                          className={`chat-feedback-button${activeTurn.feedback === "up" ? " active" : ""}`}
                          onClick={() => toggleFeedback(activeTurn.id, "up")}
                          data-tooltip="Good answer"
                        >
                          <ThumbsUpIcon size={12} />
                        </button>
                        <button
                          type="button"
                          className={`chat-feedback-button${activeTurn.feedback === "down" ? " active" : ""}`}
                          onClick={() => toggleFeedback(activeTurn.id, "down")}
                          data-tooltip="Not useful"
                        >
                          <ThumbsDownIcon size={12} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          </div>

          {error && <p className="overlay-error">{error}</p>}
        </>
      )}
    </div>
  );
}

export type { AnswerLength, ResponseStyle };
