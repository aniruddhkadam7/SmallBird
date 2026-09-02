import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import ReactMarkdown from "react-markdown";
import type { TranscriptSegment } from "./types";
import { MeetingSummaryView, type MeetingSummary } from "./MeetingSummary";
import {
  loadMeetingOverlaySettings,
  saveMeetingOverlaySettings,
  SIZE_FRACTIONS,
  type MeetingOverlaySettings,
} from "./meetingOverlaySettings";
import { loadOverlaySettings } from "./overlaySettings";
import { MeetingOverlaySettingsPanel } from "./MeetingOverlaySettingsPanel";
import { AudioLevelBars, useSttSpeaking } from "./ui";
import { loadLlmProvider } from "./llmProviderSetting";

/// Range for the header's opacity slider — matches Interview Mode's overlay
/// (see OPACITY_MIN/MAX in InterviewOverlay.tsx and MIN_USABLE_OPACITY in
/// meetingOverlaySettings.ts).
const OPACITY_MIN = 0.15;
const OPACITY_MAX = 1;

interface OverlayCaptureStatus {
  excluded: boolean;
}

interface Turn {
  id: string;
  question: string;
  answer: string;
  pending: boolean;
  failed?: boolean;
}

interface TranscriptEntry {
  id: string;
  speaker: "Others" | "Me";
  text: string;
}

interface ActiveMeetingInfo {
  meetingTitle: string;
  participants: string;
}

const overlayWindow = getCurrentWebviewWindow();

function loadActiveMeeting(): ActiveMeetingInfo {
  try {
    const raw = window.localStorage.getItem("meeting-mode:active-meeting");
    if (!raw) return { meetingTitle: "", participants: "" };
    const parsed = JSON.parse(raw);
    return {
      meetingTitle: parsed.meetingTitle || "",
      participants: parsed.participants || "",
    };
  } catch {
    return { meetingTitle: "", participants: "" };
  }
}

export function MeetingOverlay() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captureExcluded, setCaptureExcluded] = useState<boolean | null>(null);
  const [captureActive, setCaptureActive] = useState(false);
  // Mic/system-audio mute — same mechanism as Interview Mode's overlay, see
  // its toggleMute for the full explanation.
  const [muted, setMuted] = useState(false);
  const [muteBusy, setMuteBusy] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Shows the opacity percentage in the header for a moment after adjusting
  // — matches Interview Mode's overlay.
  const [opacityHint, setOpacityHint] = useState(false);
  const [settings, setSettings] = useState<MeetingOverlaySettings>(() => loadMeetingOverlaySettings());
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [ending, setEnding] = useState(false);
  // `ending` is unread while the End Meeting button (see the comment near
  // `requestClose` below) is temporarily removed from the UI — kept here,
  // not deleted, so restoring the button is a one-line change. This no-op
  // reference just satisfies `noUnusedLocals` in the meantime.
  void ending;
  const sttSpeaking = useSttSpeaking();

  const questionRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  const sessionStartedAtRef = useRef(Date.now());
  const meetingInfoRef = useRef<ActiveMeetingInfo>(loadActiveMeeting());
  // All transcript segments (as they finalize), used to build turns for
  // end_meeting — kept separate from the trimmed `transcript` UI list.
  const rawTurnsRef = useRef<{ speaker: "ME" | "OTHER"; text: string }[]>([]);
  const hintTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    saveMeetingOverlaySettings(settings);
  }, [settings]);

  useEffect(() => {
    invoke<OverlayCaptureStatus>("show_meeting_overlay")
      .then((status) => setCaptureExcluded(status.excluded))
      .catch((e) => setError(String(e)));

    // A brand-new overlay window starts at the Rust-side default size, which
    // does not know about a returning user's saved Small/Medium/Large choice
    // — apply it here, same as Interview Mode's overlay.
    invoke("resize_meeting_overlay", { fraction: SIZE_FRACTIONS[settings.size] }).catch(() => {
      // Best-effort — the window simply stays at its default size.
    });

    invoke("start_system_audio_capture")
      .then(() => setCaptureActive(true))
      .catch((e) => {
        if (String(e) !== "capture already running") {
          setError(`Could not start audio capture: ${String(e)}`);
        } else {
          setCaptureActive(true);
        }
      });
  }, []);

  // The overlay window is *reused* across meetings, not recreated (see
  // overlay_window.rs's show_overlay_window) — its WebView2 process/DOM
  // stays alive while hidden between "Close" and the next "Start". Without
  // this, reopening for a brand-new meeting would still show the previous
  // meeting's Summary screen (or a stuck "Ending…") the instant the window
  // reappears, since none of this component's state resets on its own.
  // The Rust side emits this right before re-showing an existing window.
  useEffect(() => {
    const unlistenReset = listen("overlay:reset-session", () => {
      sessionActiveRef.current = true;
      setSummary(null);
      setTurns([]);
      setTranscript([]);
      setQuestion("");
      setBusy(false);
      setEnding(false);
      setError(null);
      setConfirmingClose(false);
      setSettingsOpen(false);
      setMuted(false);
      rawTurnsRef.current = [];
      busyRef.current = false;
      meetingInfoRef.current = loadActiveMeeting();
      sessionStartedAtRef.current = Date.now();
    });
    return () => {
      unlistenReset.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const unlistenTranscript = listen<TranscriptSegment>("transcript:update", (event) => {
      const segment = event.payload;
      const speaker = segment.source === "SYSTEM_AUDIO" ? "Others" : "Me";
      if (segment.final_text) {
        setTranscript((prev) => [
          ...prev.slice(-49),
          { id: segment.id, speaker, text: segment.final_text as string },
        ]);
        rawTurnsRef.current.push({
          speaker: speaker === "Others" ? "OTHER" : "ME",
          text: segment.final_text,
        });
      }
    });

    const unlistenDelta = listen<string>("meeting-mode:answer-delta", (event) => {
      setTurns((prev) => {
        if (!prev.length) return prev;
        const last = prev[prev.length - 1];
        if (!last.pending) return prev;
        return [...prev.slice(0, -1), { ...last, answer: last.answer + event.payload }];
      });
    });

    const unlistenComplete = listen<string>("meeting-mode:answer-complete", (event) => {
      setTurns((prev) => {
        if (!prev.length) return prev;
        const last = prev[prev.length - 1];
        if (!last.pending) return prev;
        return [...prev.slice(0, -1), { ...last, answer: event.payload || last.answer, pending: false }];
      });
      busyRef.current = false;
      setBusy(false);
    });

    return () => {
      unlistenTranscript.then((f) => f());
      unlistenDelta.then((f) => f());
      unlistenComplete.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, transcript]);

  const askAI = useCallback(async () => {
    const trimmed = question.trim();
    if (!trimmed || busyRef.current) return;

    setError(null);
    const turn: Turn = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      question: trimmed,
      answer: "",
      pending: true,
    };
    setTurns((prev) => [...prev, turn]);
    setQuestion("");
    busyRef.current = true;
    setBusy(true);

    const history = turns
      .filter((t) => !t.pending && t.answer.trim() && !t.failed)
      .map((t) => ({ question: t.question, answer: t.answer }));

    try {
      const info = meetingInfoRef.current;
      const chosenProvider = loadLlmProvider();
      // answerLength/responseStyle/humanization come from the shared
      // Personalization settings (Settings > Personalization in the main
      // window) — read fresh on each ask so a change there applies to the
      // very next question without needing to restart the meeting.
      const personalization = loadOverlaySettings();
      await invoke<string>("ask_meeting_question", {
        question: trimmed,
        history,
        options: {
          answerLength: personalization.answerLength,
          responseStyle: personalization.responseStyle,
          humanization: personalization.humanization,
          meetingTitle: info.meetingTitle || null,
          participants: info.participants || null,
          // See InterviewOverlay.tsx's identical guard — DeepSeek isn't
          // implemented backend-side yet.
          llmProvider:
            chosenProvider === "anthropic" || chosenProvider === "openai" || chosenProvider === "gemini"
              ? chosenProvider
              : null,
        },
      });
    } catch (e) {
      setError(String(e));
      setTurns((prev) => prev.map((t) => (t.id === turn.id ? { ...t, pending: false, failed: true } : t)));
      busyRef.current = false;
      setBusy(false);
    }
  }, [question, turns]);

  const handleQuestionKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        askAI();
      }
    },
    [askAI],
  );

  // Set false the instant the user closes the overlay (see closeOverlay
  // below) — endMeeting's async continuation checks this before touching
  // any state, so a slow/hanging backend summarize call that's still in
  // flight when the user taps "Close anyway" mid-request can't call
  // setSummary/setError/setEnding into a window that's no longer the
  // user's current session. Left true across a normal open/close/reopen
  // cycle would be wrong (the same overlay window instance is reused, not
  // recreated — see overlay_window.rs), so this is reset to true at the
  // top of endMeeting itself, not just once at mount.
  const sessionActiveRef = useRef(true);

  const closeOverlay = useCallback(async () => {
    sessionActiveRef.current = false;
    setConfirmingClose(false);
    invoke("hide_meeting_overlay").catch(() => overlayWindow.hide());
  }, []);

  const endMeeting = useCallback(async () => {
    sessionActiveRef.current = true;
    setEnding(true);
    setError(null);
    try {
      await invoke("stop_audio_capture").catch(() => {});
      const info = meetingInfoRef.current;
      const result = await invoke<MeetingSummary>("end_meeting", {
        turns: rawTurnsRef.current,
        meetingTitle: info.meetingTitle || null,
        participants: info.participants || null,
      });
      if (!sessionActiveRef.current) return;
      setSummary(result);
      try {
        await invoke("archive_meeting", {
          startedAtMs: sessionStartedAtRef.current,
          meetingTitle: info.meetingTitle || null,
          participants: info.participants || null,
          turns: rawTurnsRef.current,
          summary: result,
        });
      } catch (e) {
        console.error("Failed to archive meeting:", e);
      }
    } catch (e) {
      if (sessionActiveRef.current) setError(String(e));
    } finally {
      if (sessionActiveRef.current) setEnding(false);
    }
  }, []);
  // `endMeeting` is unread while its button is temporarily removed from the
  // UI (see the comment near `requestClose`'s JSX usage below) — kept here,
  // not deleted, so restoring the button is a one-line change. This no-op
  // reference just satisfies `noUnusedLocals` in the meantime.
  void endMeeting;

  const requestClose = useCallback(() => {
    const hasConversation = turns.length > 0 || rawTurnsRef.current.length > 0;
    if (hasConversation && !summary) {
      setConfirmingClose(true);
    } else {
      closeOverlay();
    }
  }, [turns, summary, closeOverlay]);

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

  const handleOpacityChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, Number(e.target.value)));
    setSettings((prev) => ({ ...prev, opacity: next }));
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
      const activeIsTextarea = document.activeElement === questionRef.current;
      if (e.key === "Enter" && !activeIsTextarea && !summary) {
        e.preventDefault();
        askAI();
      } else if (e.key === "Escape") {
        requestClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [askAI, settingsOpen, confirmingClose, requestClose, summary]);

  const hasConversation = turns.length > 0;
  const opacityPercent = Math.round(settings.opacity * 100);
  const overlayStyle: React.CSSProperties = {
    fontSize: `${settings.fontSize}px`,
    ["--overlay-alpha" as string]: settings.opacity,
  };

  if (summary) {
    return (
      <div
        className={`overlay-root density-${settings.density} size-${settings.size}`}
        style={overlayStyle}
      >
        <div
          className="overlay-header"
          data-tauri-drag-region={settings.dragEnabled ? "deep" : undefined}
        >
          <div className="overlay-title">Meeting Ended</div>
          <div className="overlay-header-actions">
            <button className="overlay-icon-button close" onClick={closeOverlay} title="Close">
              ✕
            </button>
          </div>
        </div>
        <div className="overlay-chat" ref={scrollRef}>
          <MeetingSummaryView summary={summary} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`overlay-root density-${settings.density} size-${settings.size}`}
      style={overlayStyle}
    >
      <div
        className="overlay-header"
        data-tauri-drag-region={settings.dragEnabled ? "deep" : undefined}
      >
        <AudioLevelBars active={sttSpeaking && !busy} />
        <div className="overlay-title">
          {opacityHint ? `Opacity ${opacityPercent}%` : busy ? "Answering…" : muted ? "Muted" : "Meeting"}
        </div>
        <div className="overlay-header-actions">
          {/* Pauses/resumes audio capture — same mechanism as Interview
              Mode's overlay, see its equivalent button for the full
              explanation. */}
          <button
            type="button"
            className={`overlay-icon-button${muted ? " on" : ""}`}
            onClick={toggleMute}
            disabled={!captureActive || muteBusy}
            title={muted ? "Unmute — resume transcribing" : "Mute — pause transcribing"}
          >
            {muted ? "🔇" : "🎤"}
          </button>

          {/* Visual parity with Interview Mode's overlay only — Interview's
              Auto AI auto-sends the interviewer's live-dictated question on
              silence, which has no equivalent here since Meeting's question
              box is manually typed, not dictated. Permanently off/disabled
              rather than wired to real settings state or any send
              behavior. */}
          <button
            type="button"
            className="overlay-auto-ai-toggle"
            disabled
            title="Auto AI is not available in Meeting Mode — questions here are typed, not dictated"
          >
            <span className="overlay-auto-ai-dot" />
            Auto AI
          </button>

          <input
            type="range"
            className="overlay-opacity-slider"
            min={OPACITY_MIN}
            max={OPACITY_MAX}
            step={0.01}
            value={settings.opacity}
            onChange={handleOpacityChange}
            aria-label="Overlay opacity"
            title={`Opacity — ${opacityPercent}%`}
          />
          <button
            className="overlay-icon-button"
            onClick={() => setSettingsOpen((v) => !v)}
            title="Settings"
          >
            ⚙
          </button>
          {/* End Meeting (endMeeting/the AI summary flow below) is
              temporarily removed from the UI — it was triggering a freeze
              under investigation. The handler and summary screen are still
              here, just unreachable, so it's a one-line change to bring
              back once the underlying issue is found. */}
          <button className="overlay-icon-button close" onClick={requestClose} title="Close">
            ✕
          </button>
        </div>
      </div>

      {confirmingClose ? (
        <div className="overlay-confirm-close">
          <p className="overlay-confirm-close-title">Is the meeting over?</p>
          <p className="overlay-confirm-close-body">Closing without ending the meeting will lose the summary.</p>
          <div className="overlay-confirm-close-actions">
            <button className="overlay-text-button" onClick={() => setConfirmingClose(false)}>
              Keep going
            </button>
            <button className="overlay-text-button primary" onClick={closeOverlay}>
              Close anyway
            </button>
          </div>
        </div>
      ) : settingsOpen ? (
        <MeetingOverlaySettingsPanel
          settings={settings}
          onChange={setSettings}
          onClose={() => setSettingsOpen(false)}
          captureExcluded={captureExcluded}
        />
      ) : (
        <>
          <div className="overlay-chat" ref={scrollRef}>
            {!hasConversation && transcript.length === 0 && (
              <p className="overlay-empty">Waiting for the meeting to begin…</p>
            )}

            {transcript.map((entry) => (
              <div className="chat-message interviewer" key={entry.id}>
                <span className="chat-role">{entry.speaker}</span>
                <p className="chat-text">{entry.text}</p>
              </div>
            ))}

            {turns.map((turn) => (
              <div key={turn.id} className="chat-turn">
                <div className="chat-message interviewer">
                  <span className="chat-role">You asked</span>
                  <p className="chat-text">{turn.question}</p>
                </div>
                <div className={`chat-message assistant${turn.failed ? " failed" : ""}`}>
                  <span className="chat-role">Answer</span>
                  {turn.answer ? (
                    <div className="chat-text chat-markdown">
                      <ReactMarkdown>{turn.answer}</ReactMarkdown>
                    </div>
                  ) : turn.failed ? (
                    <p className="chat-text muted">Couldn't get an answer.</p>
                  ) : (
                    <p className="chat-text muted thinking">Thinking…</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="overlay-compose">
            <textarea
              ref={questionRef}
              className="overlay-question-input"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleQuestionKeyDown}
              placeholder="Ask a question…"
              rows={1}
            />
            <button
              className="overlay-ask-button"
              onClick={askAI}
              disabled={!question.trim() || busy}
              title="Ask (Enter)"
            >
              Ask
            </button>
          </div>

          {error && <p className="overlay-error">{error}</p>}
          {captureExcluded === false && (
            <p className="overlay-error">Warning: this window may be visible in screen shares.</p>
          )}
        </>
      )}
    </div>
  );
}
