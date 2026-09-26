import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isOutOfMinutesMessage } from "./outOfMinutes";
import { CameraIcon, CloseIcon, MaximizeIcon, MinimizeIcon, RestoreSizeIcon, SpeakerIcon, VoiceIcon } from "./OverlayIcons";
import { appendSpeech, hasSpeakerLabels, isEcho, rememberHeard, speakerLabel, type HeardSpeech } from "./speakerBuffer";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { TranscriptSegment } from "./types";
import {
  loadOverlaySettings,
  saveOverlaySettings,
  SIZE_FRACTIONS,
  type AnswerLength,
  type OverlaySettings,
  type ResponseStyle,
} from "./overlaySettings";
import { OverlaySettingsPanel } from "./OverlaySettingsPanel";
import {
  AUTO_AI_SILENCE_MS_COMPLETE,
  AUTO_AI_SILENCE_MS_INCOMPLETE,
  classifyQuestionCompleteness,
} from "./questionCompleteness";
import { AudioLevelBars, useSttSpeaking } from "./ui";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  GearIcon,
  MessageIcon,
  MoveIcon,
  SendIcon,
  StarIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "./OverlayIcons";
import { loadLlmProvider } from "./llmProviderSetting";
import { getEntitlement } from "./auth";

function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  // An hour or more: "2h 05m" — seconds ticking by don't matter yet.
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/// The small box has room for only a few characters: "2h 5m" / "42m" / "45s".
function formatCountdownShort(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${clamped}s`;
}

/// Under five minutes left, the counter turns amber so running out never
/// comes as a surprise mid-answer.
const LOW_TIME_SECONDS = 5 * 60;

/// Shown when the countdown runs out (same wording the server uses when it
/// ends a session for the same reason — see session-heartbeat).
const TIME_UP_MESSAGE = "You've used all your minutes, so this session has ended. Top up to keep going.";

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
  /// Answered with the Deep Answer model (slower, stronger reasoning) —
  /// shows a "Deep" badge and a "Thinking deeply…" state.
  deep?: boolean;
  /// Thumbnails of the screenshots sent with this question, shown on its
  /// question card. Local-only.
  shots?: string[];
}

/// A screenshot captured from the overlay's Screenshot button, waiting to be
/// sent with the next Answer/Deep Answer. Only the thumbnail lives here — the
/// full image stays on the Rust side (see `capture_screenshot`).
interface Shot {
  key: string;
  id: string | null;
  thumbnail: string | null;
  status: "capturing" | "ready" | "error";
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

/// Role/company fields sent to `save_interview_session`. The transcripts
/// table has no mode column, so a meeting is recorded as role "Meeting:
/// <topic>" — enough to tell it apart on the dashboard without a schema
/// change.
function transcriptLabels(settings: OverlaySettings): { role: string | null; company: string | null } {
  if (settings.mode === "assistant") {
    return { role: "Assistant", company: null };
  }
  if (settings.mode === "meeting") {
    const topic = settings.meetingTopic.trim();
    return { role: topic ? `Meeting: ${topic}` : "Meeting", company: null };
  }
  return { role: settings.role.trim() || null, company: settings.company.trim() || null };
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
  const [shots, setShots] = useState<Shot[]>([]);
  // Latest shots for askAI, which awaits in-flight captures and so can't
  // rely on the render-time `shots` it closed over.
  const shotsRef = useRef<Shot[]>([]);
  shotsRef.current = shots;
  const captureInFlightRef = useRef<Set<Promise<unknown>>>(new Set());
  // Chat mode: a manual, typed-only way to ask something without touching
  // the live-transcript buffer — see `sendChat`. Off by default; the
  // overlay's primary flow stays transcript + Ask AI / Analyze Screen.
  const [chatMode, setChatMode] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  // Whether Row B (status readout + Auto AI/opacity/settings) is revealed —
  // tucked behind the "⋮" (More) icon in Row A rather than always visible.
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
  // The two audio sources, each switched by its own icon. Every session
  // starts with its mode's defaults: the call audio on and the user's mic off
  // in Interview/Meeting; the mic on and the call audio off in Assistant.
  const [systemEnabled, setSystemEnabled] = useState(() => loadOverlaySettings().mode !== "assistant");
  const [micEnabled, setMicEnabled] = useState(() => loadOverlaySettings().mode === "assistant");
  const systemOnRef = useRef(systemEnabled);
  // Minimized into the small box in the bottom-right corner (same window,
  // resized — see overlay_window.rs's minimize_overlay). The session keeps
  // running; an answer that finishes meanwhile shows as "Answer ready".
  const [minimized, setMinimized] = useState(false);
  const minimizedRef = useRef(false);
  const [unseenAnswer, setUnseenAnswer] = useState(false);
  // The minimized box folded down to just its top strip.
  const [miniStrip, setMiniStrip] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const miniScrollRef = useRef<HTMLDivElement | null>(null);
  // True only while STT is actively producing transcript output right now —
  // gates the listening animation so it doesn't run through silence just
  // because capture is technically still open.
  const sttSpeaking = useSttSpeaking();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  // Shown after archiving a non-empty interview, in place of immediately
  // hiding the overlay — gives the user a beat to jump straight to the
  // synced transcript on the website dashboard instead of having to find
  // their way there separately afterward.
  const [showEndedSummary, setShowEndedSummary] = useState(false);
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
  const isMeeting = settings.mode === "meeting";
  const isAssistant = settings.mode === "assistant";
  // Answers render like a chat app's in every mode — headings, tables,
  // lists (GFM for tables; styling in .rich-markdown).
  const markdownPlugins = [remarkGfm];
  const markdownClass = " rich-markdown";
  const sessionNoun = isAssistant ? "session" : isMeeting ? "meeting" : "interview";
  // What the empty overlay says before anything has been asked.
  const waitingText = isAssistant
    ? "Ask me anything — type, speak, or take a screenshot"
    : isMeeting
      ? "Waiting for someone to speak…"
      : "Waiting for the interviewer to speak…";
  // Remaining plan balance at the moment this session started, in seconds —
  // ticked down locally by elapsedSeconds rather than re-fetched every
  // second, so the display doesn't depend on network latency. The real
  // enforcement happens server-side (see usage-report/entitlement checks);
  // this is purely a visible countdown so the user isn't surprised by
  // running out mid-answer.
  const [remainingSecondsAtStart, setRemainingSecondsAtStart] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const secondsLeft = remainingSecondsAtStart === null ? null : Math.max(0, remainingSecondsAtStart - elapsedSeconds);
  const lowTime = secondsLeft !== null && secondsLeft < LOW_TIME_SECONDS;

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
  // Keyed by segment id, with its source — with the Mic on, the other side
  // and the user can both be mid-sentence at once.
  const partialsRef = useRef(new Map<string, { source: TranscriptSegment["source"]; text: string }>());
  // Segment ids whose upcoming final_text should be dropped rather than
  // appended, because they were already folded into a question that was
  // just sent (see askAI). Each is cleared once its final arrives (or a new
  // question starts).
  const suppressFinalIdsRef = useRef(new Set<string>());
  // The user's microphone, confirmed on by the backend (see the Mic effect
  // below); read from the transcript listener via the ref.
  const [micActive, setMicActive] = useState(false);
  const micOnRef = useRef(false);
  // What the call audio said in the last few seconds — mic text that just
  // repeats it is the speakers being picked up, not the user (see
  // speakerBuffer.ts's isEcho).
  const recentHeardRef = useRef<HeardSpeech[]>([]);
  const sessionStartedAtRef = useRef(Date.now());
  // Stable id for the session currently in progress, generated once and
  // reused on every `save_interview_session` call for it (see the
  // turns-effect below and closeOverlay) — that's what makes each call an
  // upsert of the same row instead of a new one, so a transcript is durable
  // against a crash/quit mid-interview rather than only ever written once
  // at the end.
  const sessionIdRef = useRef(crypto.randomUUID());
  // How many completed turns have been saved so far for the current
  // session — only re-save when this count grows, so streaming updates to
  // an in-flight (still-pending) answer don't trigger redundant saves.
  const savedTurnCountRef = useRef(0);
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

    const armAutoAiTimer = (delayOverride?: number) => {
      clearAutoAiTimer();
      if (!autoAIEnabledRef.current || busyRef.current) return;
      const completeness = classifyQuestionCompleteness(committedRef.current);
      const delay =
        delayOverride ??
        (completeness === "complete" ? AUTO_AI_SILENCE_MS_COMPLETE : AUTO_AI_SILENCE_MS_INCOMPLETE);
      autoAiTimerRef.current = window.setTimeout(() => {
        autoAiTimerRef.current = null;
        askAIRef.current();
      }, delay);
    };

    // The field shows what's committed plus whatever is still mid-sentence.
    // Mic off: plain dictation of the call audio, as always. Mic on: "Them:"
    // / "You:" lines (see speakerBuffer.ts).
    const renderQuestion = () => {
      let text = committedRef.current;
      for (const partial of partialsRef.current.values()) {
        text = appendSpeech(text, speakerLabel(partial.source, micOnRef.current && systemOnRef.current, text), partial.text);
      }
      setQuestion(text);
    };

    const unlistenTranscript = listen<TranscriptSegment>("transcript:update", (event) => {
      const segment = event.payload;
      const fromMic = segment.source === "MICROPHONE";
      if (fromMic && !micOnRef.current) return;
      // While an answer is streaming, keep buffering finals silently: the
      // interviewer may already be asking the next question. They land in the
      // field, not in the answer that's still arriving.
      if (segment.final_text) {
        partialsRef.current.delete(segment.id);
        if (suppressFinalIdsRef.current.delete(segment.id)) {
          // This final belongs to the utterance that was already sent as
          // part of the previous question (via its partial text) — drop it
          // instead of letting it repopulate the now-cleared field.
          renderQuestion();
          return;
        }
        if (fromMic) {
          if (isEcho(segment.final_text, recentHeardRef.current)) {
            renderQuestion();
            return;
          }
        } else {
          recentHeardRef.current = rememberHeard(recentHeardRef.current, segment.final_text);
        }
        committedRef.current = appendSpeech(
          committedRef.current,
          speakerLabel(segment.source, micOnRef.current && systemOnRef.current, committedRef.current),
          segment.final_text,
        );
        renderQuestion();
        if (!fromMic || !systemOnRef.current) {
          // The call audio — or, with it off, the user's own voice — is
          // where questions come from.
          armAutoAiTimer();
        } else if (/^Them:/m.test(committedRef.current)) {
          // The user finished speaking after the other side asked something:
          // Auto Answer still helps (continuing their point), but with the
          // longer pause so it never cuts in while they're gathering thoughts.
          armAutoAiTimer(AUTO_AI_SILENCE_MS_INCOMPLETE);
        }
      } else if (segment.partial_text) {
        if (suppressFinalIdsRef.current.has(segment.id)) return;
        if (fromMic) {
          const heardNow = [...partialsRef.current.values()].filter((p) => p.source !== "MICROPHONE").map((p) => p.text);
          if (isEcho(segment.partial_text, recentHeardRef.current, heardNow)) return;
        }
        partialsRef.current.set(segment.id, { source: segment.source, text: segment.partial_text });
        renderQuestion();
        // Still speaking (either side) — any timer counting down from an
        // earlier final must not fire mid-sentence.
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
      if (minimizedRef.current) setUnseenAnswer(true);
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
    // The backend delivers most answers in one late burst rather than a
    // true token-by-token trickle (confirmed live: `llm_first_token` and
    // `llm_total` telemetry land within ~10-30ms of each other), so the old
    // fixed "1 + remaining/150 words per 30ms tick" pacing was really just
    // adding its own multi-second typewriter delay on top of the real
    // network/model wait — for a ~100-word answer that's several extra
    // seconds of pure animation the interviewer is left waiting through for
    // no reason. This reveals a fraction of whatever's left each tick
    // instead of a fixed word count, so the animation time shrinks
    // geometrically with what's already on screen: it still reads as a
    // smooth reveal, but the whole answer is fully visible in a couple
    // hundred milliseconds regardless of length, instead of scaling with it.
    const TICK_MS = 20;
    const MIN_CHARS_PER_TICK = 12;
    const REVEAL_FRACTION = 0.35;
    const advance = (full: string, shown: number): number => {
      const remaining = full.length - shown;
      if (remaining <= 0) return shown;
      const charsThisTick = Math.max(MIN_CHARS_PER_TICK, Math.ceil(remaining * REVEAL_FRACTION));
      let pos = Math.min(shown + charsThisTick, full.length);
      if (pos < full.length) {
        const nextSpace = full.indexOf(" ", pos);
        pos = nextSpace === -1 ? full.length : nextSpace + 1;
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

  // Persists progress after every completed Ask AI turn, not just when the
  // overlay is closed — a transcript must survive a crash, force-quit, app
  // restart, or lost network mid-interview, none of which give this
  // component a chance to run its own close/cleanup code. Each call is an
  // upsert (same sessionIdRef for the whole session), so this just keeps
  // extending the same saved entry rather than creating a new one per turn.
  // Only fires when the completed-turn count actually grows, so streaming
  // deltas into a still-pending answer don't trigger a save per keystroke.
  useEffect(() => {
    const completed = turns.filter((t) => !t.pending && !t.failed && t.answer.trim());
    if (completed.length <= savedTurnCountRef.current) return;
    savedTurnCountRef.current = completed.length;
    invoke("save_interview_session", {
      id: sessionIdRef.current,
      startedAtMs: sessionStartedAtRef.current,
      ...transcriptLabels(settings),
      turns: completed.map((t) => ({ question: t.question, answer: t.answer, askedAtMs: t.askedAt })),
    }).catch((e) => console.error("Failed to save interview progress:", e));
  }, [turns, settings]);

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
    // Pre-built at launch (see lib.rs), this window loads hidden and must
    // stay hidden until Start / the shortcut shows it — only an overlay
    // that was built by being shown calls show here (to learn its capture
    // status, as before).
    overlayWindow
      .isVisible()
      .then((visible) => {
        if (!visible) return;
        return invoke<OverlayCaptureStatus>("show_interview_overlay").then((status) => {
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
        });
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

    // Audio capture is started only by App.tsx (Start button / overlay
    // shortcut), never by this window on its own — it's pre-built hidden at
    // launch, and nothing may record until the user explicitly starts.
    // Capture state is tracked via recording:state (see syncRecordingState).
  }, []);

  // Mic/mute state comes from the backend's actual capture state, not a
  // one-time check. `captureActive` used to be set only when this window was
  // first created — but the window is reused across sessions, so if that
  // first check failed (or a session ended), every later session kept a
  // stale value and the mute button stayed disabled. The backend emits
  // recording:state on every transition (Starting/Recording/Paused/
  // Stopping/Stopped/Idle); the sync call covers transitions that happened
  // before this listener existed (e.g. capture started just before the
  // overlay was shown).
  const applyRecordingState = useCallback((state: string) => {
    setCaptureActive(state === "RECORDING" || state === "PAUSED");
    setMuted(state === "PAUSED");
  }, []);
  const syncRecordingState = useCallback(() => {
    invoke<string>("get_recording_state")
      .then(applyRecordingState)
      .catch(() => {});
  }, [applyRecordingState]);
  useEffect(() => {
    syncRecordingState();
    const unlisten = listen<{ state: string }>("recording:state", (event) => applyRecordingState(event.payload.state));
    return () => {
      unlisten.then((f) => f());
    };
  }, [applyRecordingState, syncRecordingState]);

  // The Mic toggle is a saved preference; the microphone itself only runs
  // while a session is live (the backend stops it with the session). Starts
  // it when a session begins with Mic on, and follows the toggle mid-session.
  useEffect(() => {
    micOnRef.current = micActive;
  }, [micActive]);
  // Sent on every change and once on load: the backend records the mic from
  // the very next key press when it's on, and turns it on/off mid-session.
  useEffect(() => {
    invoke<boolean>("set_microphone_enabled", { enabled: micEnabled }).catch((e) => {
      setError(`Microphone: ${e}`);
      setMicEnabled(false);
    });
  }, [micEnabled]);
  useEffect(() => {
    systemOnRef.current = systemEnabled;
    invoke<boolean>("set_system_audio_enabled", { enabled: systemEnabled }).catch((e) => {
      setError(`Call audio: ${e}`);
      setSystemEnabled(true);
    });
  }, [systemEnabled]);
  useEffect(() => {
    if (!captureActive) setMicActive(false);
  }, [captureActive]);
  // Audio is recorded from the key press, seconds before the session has
  // connected (captureActive) — the icons show "listening" from that moment.
  const [prebuffering, setPrebuffering] = useState(false);
  useEffect(() => {
    const unlisten = listen<boolean>("audio:prebuffer", (event) => setPrebuffering(event.payload));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);
  useEffect(() => {
    if (captureActive) setPrebuffering(false);
  }, [captureActive]);
  const listening = captureActive || prebuffering;
  // Whether the user is talking right now (their mic's level), for the voice
  // icon's waves. Only flips state on a change, not on every audio chunk.
  const [youSpeaking, setYouSpeaking] = useState(false);
  useEffect(() => {
    let quietTimer: number | null = null;
    let speaking = false;
    const unlistenLevel = listen<{ source: string; rms_level: number }>("audio:level", (event) => {
      if (event.payload.source !== "MICROPHONE" || event.payload.rms_level < 0.02) return;
      if (!speaking) {
        speaking = true;
        setYouSpeaking(true);
      }
      if (quietTimer) window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(() => {
        speaking = false;
        setYouSpeaking(false);
      }, 400);
    });
    const unlistenState = listen<boolean>("audio:mic-state", (event) => {
      setMicActive(event.payload);
      if (!event.payload) setYouSpeaking(false);
    });
    return () => {
      unlistenLevel.then((f) => f());
      unlistenState.then((f) => f());
      if (quietTimer) window.clearTimeout(quietTimer);
    };
  }, []);
  // A mode shortcut (Start Interview/Meeting/Assistant) was pressed: this
  // window was just shown and reset — take on that mode's wording and audio
  // icons now, before the main window gets to save it.
  useEffect(() => {
    const unlisten = listen<OverlaySettings["mode"] | null>("shortcut:start-session", (event) => {
      const mode = event.payload;
      if (!mode) return;
      setSettings((prev) => ({ ...prev, mode }));
      setSystemEnabled(mode !== "assistant");
      setMicEnabled(mode === "assistant");
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);
  useEffect(() => {
    const unlisten = listen<string>("audio:mic-error", (event) => {
      setMicActive(false);
      setMicEnabled(false);
      setError(`Microphone stopped: ${event.payload}`);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Emitted once live transcription has given up reconnecting (see
  // stt/client.rs), or system-audio capture lost its output device with
  // nothing to fall back to (audio/system_capture.rs). Without surfacing
  // them, the overlay kept looking like it was listening while no questions
  // ever arrived.
  useEffect(() => {
    const unlistenStt = listen<string>("stt:error", (event) => {
      setError(`${event.payload}. Stop and start the session again to resume live transcription.`);
    });
    const unlistenCapture = listen<string>("audio:capture-error", (event) => {
      setError(`Stopped hearing audio: ${event.payload}. Reconnect your speakers or headphones, then stop and start the session again.`);
    });
    return () => {
      unlistenStt.then((f) => f());
      unlistenCapture.then((f) => f());
    };
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
      setShowEndedSummary(false);
      setSettingsOpen(false);
      setMuted(false);
      minimizedRef.current = false;
      timeUpRef.current = false;
      setMinimized(false);
      setMiniStrip(false);
      setUnseenAnswer(false);
      setMaximized(false);
      const assistantSession = loadOverlaySettings().mode === "assistant";
      setSystemEnabled(!assistantSession);
      setMicEnabled(assistantSession);
      // Capture was started just before this reset (App.tsx's
      // startInterview awaits it before showing the overlay) — re-read it
      // rather than trusting whatever this reused window last knew.
      syncRecordingState();
      setShots([]);
      invoke("clear_screenshots").catch(() => {});
      committedRef.current = "";
      partialsRef.current.clear();
      suppressFinalIdsRef.current.clear();
      recentHeardRef.current = [];
      busyRef.current = false;
      sessionStartedAtRef.current = Date.now();
      sessionIdRef.current = crypto.randomUUID();
      savedTurnCountRef.current = 0;
      setElapsedSeconds(0);
      getEntitlement()
        .then((info) => setRemainingSecondsAtStart(Math.round(info.remainingMinutes * 60)))
        .catch(() => {});
      // Re-showing an *existing* overlay window also always turns capture
      // protection back ON on the Rust side (overlay_window.rs's
      // show_overlay_window) — reconcile with a returning user's saved
      // preference the same way the very-first-open effect above does, so
      // choosing "off" once doesn't get silently reset on the next reopen.
      invoke<OverlayCaptureStatus>("set_overlay_capture_exclusion", { enabled: settingsRef.current.captureProtection })
        .then((s) => setCaptureExcluded(s.excluded))
        .catch(() => {});
    });
    return () => {
      unlistenReset.then((f) => f());
    };
  }, []);

  // One question/answer is shown at a time: when a new one appears, start at
  // its top. While the answer streams in, the view stays put — following the
  // growing text to the bottom pushed its opening lines out of sight in a
  // small overlay before the user could start reading.
  const activeTurnId = turns.length === 0 ? undefined : turns[Math.min(viewIndex ?? turns.length - 1, turns.length - 1)]?.id;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }, [activeTurnId]);
  const newestTurnId = turns.length > 0 ? turns[turns.length - 1].id : undefined;
  useEffect(() => {
    const el = miniScrollRef.current;
    if (el) el.scrollTop = 0;
  }, [newestTurnId]);

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
      mode: settings.mode,
      meetingTopic: settings.meetingTopic.trim() || null,
      participants: settings.participants.trim() || null,
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

  // Deep thinking (the Deep toggle / Ctrl+D) routes the answer to the slower,
  // stronger-reasoning model. With Deep on and nothing new in the question
  // box, Answer re-answers the last question instead, so a quick answer can
  // be upgraded. Read from the ref so Auto Answer's timer sees the current
  // toggle, not the one captured when it was scheduled.
  const askAI = useCallback(async () => {
    const deep = settingsRef.current.deepThinking;
    const trimmed = question.trim();
    if (busyRef.current) return;
    busyRef.current = true;
    // A tap on Answer right after a burst of Screenshot taps: let those
    // captures land first so none of them is left behind.
    if (captureInFlightRef.current.size > 0) {
      await Promise.allSettled([...captureInFlightRef.current]);
    }
    const readyShots = shotsRef.current.filter((s) => s.status === "ready" && s.id);
    const reasked =
      !trimmed && deep && readyShots.length === 0
        ? [...turns].reverse().find((t) => !t.pending && !t.failed && t.question.trim())
        : undefined;
    const questionText = trimmed || (readyShots.length > 0 ? ANALYZE_SCREEN_QUESTION_LABEL : reasked?.question);
    if (!questionText) {
      busyRef.current = false;
      return;
    }

    setError(null);
    const turn: Turn = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      question: questionText,
      answer: "",
      pending: true,
      askedAt: Date.now(),
      deep,
      shots: readyShots.map((s) => s.thumbnail!).filter(Boolean),
    };
    setTurns((prev) => [...prev, turn]);
    // Sent with this question (the Rust side consumes them) — clear the strip.
    if (readyShots.length > 0) {
      const sent = new Set(readyShots.map((s) => s.key));
      setShots((prev) => prev.filter((s) => !sent.has(s.key)));
    }
    setViewIndex(null);
    currentTurnIdRef.current = turn.id;
    revealRef.current.set(turn.id, { full: "", shown: 0, done: false });
    if (trimmed) {
      // The question moves into the conversation and the buffer resets, so
      // anything said from here starts the next question instead of being
      // appended onto one already sent.
      setQuestion("");
      committedRef.current = "";
      // If the interviewer was still mid-utterance when Ask AI was pressed,
      // its text already made it into `trimmed` via the live partial — the
      // final that STT emits for that same segment a moment later must be
      // dropped, not appended to the fresh buffer for the next question.
      for (const id of partialsRef.current.keys()) suppressFinalIdsRef.current.add(id);
      partialsRef.current.clear();
    }
    busyRef.current = true;
    setBusy(true);

    // Prior turns only — the one just pushed is the current question, and
    // completed turns are the only ones worth replaying. A re-ask leaves out
    // the quick answer being replaced, so the deep model answers fresh
    // instead of anchoring on (or repeating) it.
    const history = turns
      .filter((t) => !t.pending && t.answer.trim() && !t.failed && t !== reasked)
      .map((t) => ({ question: t.question, answer: t.answer }));

    try {
      await invoke<string>("ask_interview_question", {
        question: questionText === ANALYZE_SCREEN_QUESTION_LABEL && readyShots.length > 0 ? "" : questionText,
        history,
        options: { ...buildAskOptions(), deep, speakerLabeled: hasSpeakerLabels(questionText) },
        screenshotIds: readyShots.map((s) => s.id),
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
  // Screenshot button / Ctrl+Shift+Enter: capture only — no model call.
  // Each tap is independent (no busy lock), so tap-tap-tap works; the shots
  // ride along with the next Answer/Deep Answer.
  const takeScreenshot = useCallback(() => {
    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setShots((prev) => [...prev, { key, id: null, thumbnail: null, status: "capturing" }]);
    const capture = invoke<{ id: string; thumbnail: string }>("capture_screenshot")
      .then((shot) =>
        setShots((prev) =>
          prev.map((s) => (s.key === key ? { ...s, id: shot.id, thumbnail: shot.thumbnail, status: "ready" } : s)),
        ),
      )
      .catch((e) => {
        setError(String(e));
        setShots((prev) => prev.filter((s) => s.key !== key));
      });
    captureInFlightRef.current.add(capture);
    capture.finally(() => captureInFlightRef.current.delete(capture));
  }, []);

  const removeShot = useCallback((shot: Shot) => {
    if (shot.id) invoke("remove_screenshot", { id: shot.id }).catch(() => {});
    setShots((prev) => prev.filter((s) => s.key !== shot.key));
  }, []);

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

  // Actually hides the overlay window — the last step of ending an
  // interview, whether that's immediate (nothing was ever asked, see
  // requestClose) or after the user dismisses the post-interview summary
  // below (Close, or Open Dashboard).
  const dismissOverlay = useCallback(() => {
    setShowEndedSummary(false);
    invoke("hide_interview_overlay").catch(() => overlayWindow.hide());
  }, []);

  const openDashboard = useCallback(() => {
    invoke("open_dashboard").catch((e) => console.error("Failed to open dashboard:", e));
    dismissOverlay();
  }, [dismissOverlay]);

  // Does one final save of the Q&A turns for this session — by the time this
  // runs, every completed turn has typically already been saved by the
  // turns-effect above; this mainly just finalizes ended_at_ms and catches
  // any turn that completed in the same tick as closing. Turns still
  // pending/failed are skipped — only completed exchanges are worth keeping.
  // An empty result (nothing ever asked) is a no-op, so opening and closing
  // without using it never clutters history.
  //
  // When there's something to show for it, this hands off to the "your
  // transcript is ready" summary (see showEndedSummary) instead of hiding
  // the overlay immediately — that's what lets the user jump straight to
  // the synced dashboard from here rather than hunting for it afterward. An
  // empty session has nothing worth a summary for, so it hides right away.
  //
  // The overlay window itself is never destroyed between interviews — Rust's
  // show_overlay_window reuses the existing webview (see interview_mode/
  // window.rs) purely for speed, so this component never remounts and its
  // React state would otherwise survive from one interview into the next.
  // Clearing turns/question/committedRef/sessionStartedAtRef/sessionIdRef
  // here, right after saving, is what makes the *next* "Start Interview"
  // actually start blank instead of resuming the just-saved conversation.
  const closeOverlay = useCallback(async () => {
    setConfirmingClose(false);
    const completed = turns
      .filter((t) => !t.pending && !t.failed && t.answer.trim())
      .map((t) => ({ question: t.question, answer: t.answer, askedAtMs: t.askedAt }));
    if (completed.length > 0) {
      try {
        await invoke("save_interview_session", {
          id: sessionIdRef.current,
          startedAtMs: sessionStartedAtRef.current,
          ...transcriptLabels(settings),
          turns: completed,
        });
      } catch (e) {
        console.error("Failed to save interview session:", e);
      }
    }

    if (autoAiTimerRef.current) {
      window.clearTimeout(autoAiTimerRef.current);
      autoAiTimerRef.current = null;
    }
    committedRef.current = "";
    partialsRef.current.clear();
    suppressFinalIdsRef.current.clear();
    sessionStartedAtRef.current = Date.now();
    sessionIdRef.current = crypto.randomUUID();
    savedTurnCountRef.current = 0;
    setTurns([]);
    setQuestion("");
    setShots([]);
    invoke("clear_screenshots").catch(() => {});
    setError(null);
    busyRef.current = false;
    setBusy(false);

    if (completed.length > 0) {
      setShowEndedSummary(true);
    } else {
      dismissOverlay();
    }
  }, [turns, settings, dismissOverlay]);

  // Entry point for both the End button and Escape: conversations with at least
  // one exchange ask for confirmation first (closing mid-interview is easy to
  // trigger by accident), while an empty session just closes immediately —
  // there's nothing to lose by skipping the prompt.
  const minimizeOverlay = useCallback(() => {
    minimizedRef.current = true;
    setUnseenAnswer(false);
    setMiniStrip(false);
    setMinimized(true);
    invoke("minimize_interview_overlay").catch((e) => {
      minimizedRef.current = false;
      setMinimized(false);
      setError(`Couldn't minimize: ${e}`);
    });
  }, []);

  const toggleMaximize = useCallback(() => {
    invoke<boolean>("toggle_maximize_interview_overlay")
      .then(setMaximized)
      .catch((e) => setError(`Couldn't resize: ${e}`));
  }, []);

  const restoreOverlay = useCallback(() => {
    return invoke("restore_interview_overlay")
      .catch(() => {})
      .finally(() => {
        minimizedRef.current = false;
        setMinimized(false);
        setMiniStrip(false);
        setUnseenAnswer(false);
      });
  }, []);

  // The box's own minimize: fold down to just the top strip, or back.
  const toggleMiniStrip = useCallback(() => {
    setMiniStrip((strip) => {
      invoke("minimize_interview_overlay", { strip: !strip }).catch(() => {});
      return !strip;
    });
  }, []);

  // Time's up: save the conversation like End does, then end the session
  // through the main window (it stops listening, closes this overlay — which
  // ends the backend session — and shows why). The server enforces the same
  // limit on its own via session-heartbeat; this just stops right on time
  // instead of up to a heartbeat later.
  const closeOverlayRef = useRef(closeOverlay);
  closeOverlayRef.current = closeOverlay;
  const timeUpRef = useRef(false);
  useEffect(() => {
    if (secondsLeft !== 0 || !captureActive || timeUpRef.current) return;
    timeUpRef.current = true;
    void (async () => {
      await closeOverlayRef.current().catch(() => {});
      await emit("stt:session-ended-elsewhere", TIME_UP_MESSAGE).catch(() => {});
    })();
  }, [secondsLeft, captureActive]);

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
      if (showEndedSummary) {
        if (e.key === "Escape") dismissOverlay();
        return;
      }
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
          takeScreenshot();
        } else {
          askAI();
        }
        return;
      }
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setSettings((prev) => ({ ...prev, deepThinking: !prev.deepThinking }));
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
  }, [askAI, takeScreenshot, goPrevTurn, goNextTurn, settingsOpen, confirmingClose, showEndedSummary, dismissOverlay, requestClose]);

  const overlayStyle: React.CSSProperties = {
    fontSize: `${settings.fontSize}px`,
    // Applied to the panel background rather than the whole element, so text
    // stays fully legible while the window itself reads as translucent.
    // Forced fully opaque while the settings panel is open — the opacity
    // slider is a conversation-legibility knob, not something that should
    // also make its own controls hard to see while you're adjusting them.
    ["--overlay-alpha" as string]: settingsOpen ? 1 : settings.opacity,
  };

  const miniTurn = turns.length > 0 ? turns[turns.length - 1] : null;
  const hasConversation = turns.length > 0;
  const displayIndex = turns.length === 0 ? -1 : Math.min(viewIndex ?? turns.length - 1, turns.length - 1);
  const activeTurn = displayIndex >= 0 ? turns[displayIndex] : null;
  const opacityPercent = Math.round(settings.opacity * 100);

  if (minimized) {
    const trimmedQuestion = question.trim();
    const liveQuestion = trimmedQuestion.length > 240 ? `…${trimmedQuestion.slice(-240)}` : trimmedQuestion;
    // Same rule as the full overlay's Answer button.
    const canAnswer =
      !busy &&
      (!!trimmedQuestion ||
        shots.some((s) => s.status !== "error") ||
        (settings.deepThinking && turns.some((t) => !t.pending && !t.failed)));
    const miniStatus = busy
      ? "Answering…"
      : unseenAnswer
        ? "Answer ready"
        : !systemEnabled && !micEnabled
          ? "Not listening"
          : listening
            ? "Listening…"
            : "Starting…";
    return (
      <div className="overlay-root overlay-mini-root" style={overlayStyle}>
        {/* The whole box drags (buttons excepted); Open restores. No
            data-tooltips here — the window is too small to show them. */}
        <div className="overlay-mini">
          <div className="overlay-mini-header" data-tauri-drag-region="deep">
          {/* The same switches as the full overlay's two source icons. */}
          <button
            type="button"
            className={`overlay-status-icon overlay-source-icon${systemEnabled ? " on" : " off"}`}
            onClick={() => setSystemEnabled((on) => !on)}
            aria-pressed={systemEnabled}
            aria-label="Call audio"
          >
            <SpeakerIcon size={13} off={!systemEnabled} />
            {systemEnabled && listening && !muted && <span className="overlay-status-dot" />}
          </button>
          <button
            type="button"
            className={`overlay-status-icon overlay-source-icon overlay-voice-icon${micEnabled ? " on" : " off"}${micEnabled && listening && !muted ? " live" : ""}${micEnabled && youSpeaking && !muted ? " speaking" : ""}`}
            onClick={() => setMicEnabled((on) => !on)}
            aria-pressed={micEnabled}
            aria-label="Your microphone"
          >
            <VoiceIcon size={13} off={!micEnabled} />
            {micEnabled && listening && !muted && <span className="overlay-status-dot voice" />}
          </button>
          <span className={`overlay-mini-status${unseenAnswer ? " ready" : ""}`}>{miniStatus}</span>
          {secondsLeft !== null && (
            <span className={`overlay-time-left overlay-mini-time${lowTime ? " low" : ""}`} aria-label="Time left on your plan">
              {formatCountdownShort(secondsLeft)}
            </span>
          )}
          <button
            type="button"
            className={`overlay-pill-button${settings.autoAI ? " on" : ""}`}
            onClick={() => setSettings((prev) => ({ ...prev, autoAI: !prev.autoAI }))}
            aria-pressed={settings.autoAI}
            aria-label="Auto Answer"
          >
            Auto
          </button>
          <button type="button" className="overlay-icon-button overlay-mini-shot" onClick={takeScreenshot} aria-label="Screenshot">
            <CameraIcon />
            {shots.length > 0 && <span className="pill-count">{shots.length}</span>}
          </button>
          <button type="button" className="overlay-pill-button" onClick={() => askAI()} disabled={!canAnswer}>
            Answer
          </button>
          <span className="overlay-window-controls">
            <button
              type="button"
              className="overlay-icon-button"
              onClick={toggleMiniStrip}
              aria-label={miniStrip ? "Show the answer" : "Minimize further"}
            >
              <MinimizeIcon />
            </button>
            <button type="button" className="overlay-icon-button overlay-mini-open" onClick={restoreOverlay} aria-label="Open full overlay">
              <MaximizeIcon />
            </button>
            <button
              type="button"
              className="overlay-icon-button overlay-window-close"
              onClick={() => {
                // With a conversation, ending asks first — that prompt lives
                // in the full overlay, so open it before asking.
                if (turns.some((t) => !t.pending && t.answer.trim())) void restoreOverlay().then(requestClose);
                else requestClose();
              }}
              aria-label={`End ${sessionNoun}`}
            >
              <CloseIcon />
            </button>
          </span>
          </div>
          <div className="overlay-mini-body" ref={miniScrollRef} hidden={miniStrip}>
            {/* What's being heard right now (the question field), newest
                words kept in view. */}
            {liveQuestion && (
              <div className="overlay-mini-live">
                <span className="overlay-mini-label">Hearing</span>
                <p className="overlay-mini-live-text">{liveQuestion}</p>
              </div>
            )}
            {miniTurn ? (
              <>
                <p className="overlay-mini-question">{miniTurn.question}</p>
                {miniTurn.answer ? (
                  <div className={`chat-markdown overlay-mini-answer${markdownClass}`}>
                    <ReactMarkdown remarkPlugins={markdownPlugins} components={{ code: MarkdownCode }}>{miniTurn.answer}</ReactMarkdown>
                  </div>
                ) : miniTurn.failed ? (
                  <p className="overlay-mini-muted">Couldn't get an answer.</p>
                ) : (
                  <p className="overlay-mini-muted">{miniTurn.deep ? "Thinking deeply…" : "Thinking…"}</p>
                )}
              </>
            ) : (
              !liveQuestion && <p className="overlay-mini-muted">{waitingText}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

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
        <div className="overlay-action-bar-main">
        {/* The two audio sources, each its own switch. Call audio (speaker):
            what the PC plays — the other side; on by default, red dot while
            it's being heard. Your voice (person): your microphone; off by
            default, green dot while it's being heard. Either can be on
            without the other. */}
        <button
          type="button"
          className={`overlay-status-icon overlay-source-icon${systemEnabled ? " on" : " off"}`}
          onClick={() => setSystemEnabled((on) => !on)}
          aria-pressed={systemEnabled}
          aria-label="Call audio"
          data-tooltip={
            systemEnabled
              ? "Listening to the call — click to stop hearing the call audio"
              : "Call audio is off — click to hear the call again"
          }
        >
          <SpeakerIcon size={13} off={!systemEnabled} />
          {systemEnabled && listening && !muted && <span className="overlay-status-dot" />}
        </button>
        {/* Your own voice — the Mic switch. Off (dimmed, crossed out): only
            the call is heard. On: green dot while your mic is being heard,
            and the waves move while you talk. */}
        <button
          type="button"
          className={`overlay-status-icon overlay-source-icon overlay-voice-icon${micEnabled ? " on" : " off"}${micEnabled && listening && !muted ? " live" : ""}${micEnabled && youSpeaking && !muted ? " speaking" : ""}`}
          onClick={() => setMicEnabled((on) => !on)}
          aria-pressed={micEnabled}
          aria-label="Your microphone"
          data-tooltip={
            !micEnabled
              ? "Your mic is off — click to hear your voice too"
              : muted
                ? "Muted — your voice isn't being heard"
                : listening
                  ? "Listening to your voice — click to turn your mic off"
                  : "Your mic is on — your voice will be heard as soon as the session starts. Click to turn it off"
          }
        >
          <VoiceIcon size={13} off={!micEnabled} />
          {micEnabled && listening && !muted && <span className="overlay-status-dot voice" />}
        </button>
        <button
          type="button"
          className="overlay-pill-button"
          onClick={() => askAI()}
          disabled={
            busy ||
            (!question.trim() &&
              !shots.some((s) => s.status !== "error") &&
              !(settings.deepThinking && turns.some((t) => !t.pending && !t.failed)))
          }
          data-tooltip={
            settings.deepThinking && !question.trim() && !shots.length
              ? "Answer the last question again with deep thinking (Ctrl+Enter)"
              : "Answer (Ctrl+Enter)"
          }
        >
          Answer
        </button>
        <button
          type="button"
          className={`overlay-pill-button deep${settings.deepThinking ? " on" : ""}`}
          onClick={() => setSettings((prev) => ({ ...prev, deepThinking: !prev.deepThinking }))}
          aria-pressed={settings.deepThinking}
          data-tooltip={
            settings.deepThinking
              ? "Deep thinking is on — stronger reasoning, a few seconds slower (Ctrl+D)"
              : "Deep thinking is off — fast answers (Ctrl+D)"
          }
        >
          <span className="pill-long">Deep Answer</span>
          <span className="pill-short">Deep</span>
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
              ? `Auto Answer is on — questions send automatically when the ${isAssistant ? "speaking" : isMeeting ? "speaker" : "interviewer"} stops${isAssistant ? "" : " talking"}`
              : "Auto Answer is off — use Answer or Enter to send"
          }
        >
          <span className="pill-long">Auto Answer</span>
          <span className="pill-short">Auto</span>
        </button>
        <button
          type="button"
          className="overlay-pill-button"
          onClick={takeScreenshot}
          data-tooltip="Take a screenshot — tap as many times as you like; they're sent with your next Answer (Ctrl+Shift+Enter)"
        >
          Screenshot
          {shots.length > 0 && <span className="pill-count">{shots.length}</span>}
        </button>
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
          className={`overlay-icon-button${settingsOpen ? " on" : ""}`}
          onClick={() => setSettingsOpen((v) => !v)}
          aria-label="Settings"
          data-tooltip="Settings"
        >
          <GearIcon />
        </button>
        </div>
        {/* Window controls, like a browser's: minimize, maximize (which is
            also the size control now), close — pinned to the top-right
            corner however narrow the overlay gets. */}
        <span className="overlay-window-controls">
          <button
            type="button"
            className="overlay-icon-button"
            onClick={minimizeOverlay}
            aria-label="Minimize"
            data-tooltip="Minimize to the corner — keeps listening and answering"
          >
            <MinimizeIcon />
          </button>
          <button
            type="button"
            className="overlay-icon-button"
            onClick={toggleMaximize}
            aria-label={maximized ? "Restore size" : "Maximize"}
            data-tooltip={maximized ? "Restore size" : "Maximize"}
          >
            {maximized ? <RestoreSizeIcon /> : <MaximizeIcon />}
          </button>
          <button
            type="button"
            className="overlay-icon-button overlay-window-close"
            onClick={requestClose}
            aria-label={`End ${sessionNoun}`}
            data-tooltip={`End ${sessionNoun} (Esc)`}
          >
            <CloseIcon />
          </button>
        </span>
      </div>


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

      {showEndedSummary ? (
        <div className="overlay-confirm-close">
          <p className="overlay-confirm-close-title">
            {isAssistant ? "Session ended" : isMeeting ? "Meeting ended" : "Interview ended"}
          </p>
          <p className="overlay-confirm-close-body">
            Your transcript has been saved — view it anytime from the dashboard.
          </p>
          <div className="overlay-confirm-close-actions">
            <button className="overlay-text-button" onClick={dismissOverlay}>
              Close
            </button>
            <button className="overlay-text-button primary" onClick={openDashboard}>
              Open Dashboard
            </button>
          </div>
        </div>
      ) : confirmingClose ? (
        <div className="overlay-confirm-close">
          <p className="overlay-confirm-close-title">Is the {sessionNoun} over?</p>
          <p className="overlay-confirm-close-body">
            Closing will save this conversation to your history.
          </p>
          <div className="overlay-confirm-close-actions">
            <button className="overlay-text-button" onClick={() => setConfirmingClose(false)}>
              Keep going
            </button>
            <button className="overlay-text-button primary" onClick={closeOverlay}>
              Yes, end {sessionNoun}
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
          {shots.length > 0 && (
            <div className="overlay-shots" aria-label="Screenshots for the next answer">
              {shots.map((shot) => (
                <div key={shot.key} className={`overlay-shot${shot.status === "capturing" ? " capturing" : ""}`}>
                  {shot.thumbnail ? <img src={shot.thumbnail} alt="Screenshot" draggable={false} /> : <span className="overlay-shot-spinner" />}
                  <button
                    type="button"
                    className="overlay-shot-remove"
                    onClick={() => removeShot(shot)}
                    aria-label="Remove screenshot"
                    data-tooltip="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
              <span className="overlay-shots-hint">Sent with your next answer</span>
            </div>
          )}
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
                placeholder={
                  !systemEnabled && !micEnabled
                    ? "Not listening — turn on the call audio or your mic"
                    : !listening
                    ? "Starting to listen…"
                    : hasConversation
                    ? isAssistant
                      ? "Ask a follow-up…"
                      : "Next question…"
                    : isAssistant
                      ? "Ask anything…"
                      : isMeeting
                        ? "Waiting for someone to speak…"
                        : "Waiting for the interviewer to speak…"
                }
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
            {secondsLeft !== null && (
              <span
                className={`overlay-time-left${lowTime ? " low" : ""}`}
                data-tooltip="Time left on your plan"
              >
                {formatCountdown(secondsLeft)} left
              </span>
            )}
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
              <p className="overlay-empty">{waitingText}</p>
            ) : (
              <div className="chat-turn">
                <div className="chat-card-label question">
                  <span className="chat-card-icon">
                    <MessageIcon size={13} />
                  </span>
                  <span>Question:</span>
                  <span className="chat-card-question-text">{activeTurn.question}</span>
                  {activeTurn.shots && activeTurn.shots.length > 0 && (
                    <span className="chat-card-shots">
                      {activeTurn.shots.map((thumb, i) => (
                        <img key={i} src={thumb} alt="" draggable={false} />
                      ))}
                    </span>
                  )}
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
                    {activeTurn.deep && <span className="chat-deep-badge">Deep</span>}
                    {!activeTurn.pending && (
                      <span className="chat-answer-timestamp">
                        {formatTimestamp(activeTurn.askedAt)}
                      </span>
                    )}
                  </div>
                  {activeTurn.answer ? (
                    <div className={`chat-text chat-markdown${markdownClass}`}>
                      <ReactMarkdown remarkPlugins={markdownPlugins} components={{ code: MarkdownCode }}>{activeTurn.answer}</ReactMarkdown>
                    </div>
                  ) : activeTurn.failed ? (
                    <p className="chat-text muted">Couldn't get an answer.</p>
                  ) : (
                    <p className="chat-text muted thinking">{activeTurn.deep ? "Thinking deeply…" : "Thinking…"}</p>
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

          {error &&
            (isOutOfMinutesMessage(error) ? (
              <div className="overlay-error overlay-error-with-action">
                <span>{error}</span>
                <button
                  type="button"
                  className="overlay-pill-button"
                  onClick={() => invoke("open_upgrade").catch((e) => setError(String(e)))}
                >
                  Upgrade
                </button>
              </div>
            ) : (
              <p className="overlay-error">{error}</p>
            ))}
        </>
      )}
    </div>
  );
}

export type { AnswerLength, ResponseStyle };
