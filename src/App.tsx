import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import "./App.css";
import smallbirdLogo from "./assets/smallbird-logo.png";
import {
  countFilledSections,
  DocumentContext,
  emptyDocumentContextState,
  mergeTextUploads,
  uploadDocumentContext,
  type DocumentContextState,
} from "./DocumentContext";
import { Account } from "./Account";
import { SettingsPopover } from "./SettingsPopover";
import { LowEndHardwareBanner } from "./LowEndHardwareBanner";
import { HeaderDropdown } from "./HeaderDropdown";
import { ExpandPanel } from "./ExpandPanel";
import { loadOverlaySettings, saveOverlaySettings } from "./overlaySettings";
import { CompanySelect } from "./CompanySelect";
import { Button, Spinner } from "./ui";
import {
  IconAccount,
  IconAttachment,
  IconChevronDown,
  IconClose,
  IconMaximize,
  IconMinimize,
  IconRestore,
  IconSettings,
} from "./Icons";
import { IconAnthropic, IconDeepSeek, IconOpenAI } from "./ProviderIcons";
import {
  ASSISTANT_CONTEXT_SECTIONS,
  INSTRUCTIONS_SECTION_KEY,
  INTERVIEW_CONTEXT_SECTIONS,
  MEETING_CONTEXT_SECTIONS,
} from "./headerPopups";
import { loadLlmProvider, saveLlmProvider, type LlmProvider } from "./llmProviderSetting";
import { claimSessionModeFor, loadSessionMode, saveSessionMode, type SessionMode } from "./sessionMode";
import {
  customContextSections,
  customModeId,
  customModeValue,
  findCustomMode,
  sourceDefaults,
  loadCustomModes,
  newCustomModeId,
  saveCustomModes,
  type CustomMode,
} from "./customModes";
import { CustomModeEditor } from "./CustomModeEditor";
import { isOutOfMinutesMessage } from "./outOfMinutes";
import { sessionDetails, type HistoryEntry } from "./SessionsPanel";
import { getAuthSession, getEntitlement, type AuthSessionInfo } from "./auth";
import { checkForUpdate, installUpdate } from "./autoUpdate";
import { AudioTestStatus, useAudioTest } from "./AudioTest";

type SessionState = "IDLE" | "STARTING" | "LISTENING";
type Popover = "MODE" | "MODEL" | "CONTEXT" | "SETTINGS" | "ACCOUNT" | "START_SETUP" | "CUSTOM_MODE" | null;

const SESSION_MODES: { value: SessionMode; label: string; description: string }[] = [
  { value: "interview", label: "Interview", description: "Answers as you, the candidate" },
  { value: "meeting", label: "Meeting", description: "Suggests what to say in a meeting" },
  { value: "assistant", label: "Assistant", description: "Your personal assistant — ask anything" },
  { value: "notes", label: "Notes", description: "Writes down who said what in a meeting" },
];

const MODE_LABELS: Record<string, string> = { interview: "Interview", meeting: "Meeting", assistant: "Assistant", notes: "Notes" };

function modeLabel(mode: SessionMode, customModes: CustomMode[]): string {
  return MODE_LABELS[mode] ?? findCustomMode(mode, customModes)?.name ?? "Custom";
}

// Only "openai" and "anthropic" have a real backend implementation (see
// backend/supabase/functions/llm-proxy's PROVIDER_URLS). "gemini" was
// dropped when this build switched from BYOK to backend-metered (llm-proxy
// has no Gemini support); "deepseek" is listed so the dropdown shows it but
// stays disabled until a provider is actually built for it. "anthropic" is
// disabled too until an ANTHROPIC_API_KEY secret is funded (see
// llmProviderSetting.ts) — re-enable once that key exists.
const LLM_PROVIDERS: { value: LlmProvider; label: string; icon: typeof IconOpenAI; available: boolean }[] = [
  { value: "anthropic", label: "Anthropic", icon: IconAnthropic, available: false },
  { value: "openai", label: "OpenAI", icon: IconOpenAI, available: true },
  { value: "deepseek", label: "DeepSeek", icon: IconDeepSeek, available: false },
];

const instructionsStorageKey = (mode: SessionMode) => `smallbird:custom-instructions:${mode}`;

function saveInstructions(mode: SessionMode, text: string): void {
  try {
    window.localStorage.setItem(instructionsStorageKey(mode), text);
  } catch {
    // localStorage unavailable — instructions just won't survive a restart.
  }
}

/// Pre-fills the Custom instructions box with what was saved last time. It
/// starts un-uploaded (uploadedText ""), so the next Start sends it.
function withSavedInstructions(state: DocumentContextState, mode: SessionMode): DocumentContextState {
  let saved = "";
  try {
    saved = window.localStorage.getItem(instructionsStorageKey(mode)) ?? "";
  } catch {
    // Fall through with nothing saved.
  }
  const section = state[INSTRUCTIONS_SECTION_KEY];
  if (!saved || !section) return state;
  return { ...state, [INSTRUCTIONS_SECTION_KEY]: { ...section, text: saved } };
}

function initialCustomContext(id: string): DocumentContextState {
  return withSavedInstructions(emptyDocumentContextState(customContextSections(id)), customModeValue(id));
}

function forgetInstructions(mode: SessionMode): void {
  try {
    window.localStorage.removeItem(instructionsStorageKey(mode));
  } catch {
    // Nothing to clean up.
  }
}

// Deterministic hash-to-hue so the same email always gets the same avatar
// color across sessions — mirrors the website's account-menu.tsx pattern so
// the two surfaces feel like the same product.
function colorForEmail(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = (hash << 5) - hash + email.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

function App() {
  const [llmProvider, setLlmProvider] = useState<LlmProvider>(() => loadLlmProvider());
  const [authSession, setAuthSession] = useState<AuthSessionInfo | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>("IDLE");
  const sessionStateRef = useRef<SessionState>("IDLE");
  sessionStateRef.current = sessionState;
  // Set while a shortcut-started session is still starting; the overlay
  // closing during that window marks it cancelled so the start cleans up
  // after itself instead of leaving capture running with no session.
  const shortcutStartingRef = useRef(false);
  const shortcutStartCancelledRef = useRef(false);
  const [openPopover, setOpenPopover] = useState<Popover>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  const showStartError = useCallback(async (e: unknown) => setError(String(e)), []);
  const audioTest = useAudioTest();

  const [sessionMode, setSessionMode] = useState<SessionMode>(() => loadSessionMode());
  const isMeeting = sessionMode === "meeting";
  const isAssistant = sessionMode === "assistant";
  // Notes Mode asks nothing of the AI, so it has no context of its own — it
  // borrows Assistant's (never a resume or a meeting agenda).
  const isNotes = sessionMode === "notes";
  const usesAssistantContext = isAssistant || isNotes;

  // Modes the user created (customModes.ts) — listed after the built-in ones.
  const [customModes, setCustomModes] = useState<CustomMode[]>(() => loadCustomModes());
  useEffect(() => saveCustomModes(customModes), [customModes]);
  const selectedCustomMode = findCustomMode(sessionMode, customModes);
  // Assistant and custom modes have nothing to set up — Start begins right away.
  const startsImmediately = usesAssistantContext || selectedCustomMode !== null;
  // The mode being created/edited in the CUSTOM_MODE panel.
  const [editingMode, setEditingMode] = useState<{ mode: CustomMode; isNew: boolean } | null>(null);

  // What a new session hears, per mode: Interview/Meeting listen to the call
  // (your mic off until you turn it on); Assistant listens to your mic (the
  // call audio off); a custom mode, whichever it was set to. The backend
  // records exactly these from the key press.
  const { system: systemDefault, mic: micDefault, diarize: diarizeDefault } = sourceDefaults(sessionMode, customModes);
  useEffect(() => {
    invoke("set_source_defaults", { system: systemDefault, mic: micDefault, diarize: diarizeDefault }).catch(() => {});
  }, [systemDefault, micDefault, diarizeDefault]);

  const [interviewContext, setInterviewContext] = useState<DocumentContextState>(() =>
    withSavedInstructions(emptyDocumentContextState(INTERVIEW_CONTEXT_SECTIONS), "interview"),
  );
  // Kept separate from interviewContext (and using its own document types)
  // so switching modes never mixes a resume into a meeting or vice versa.
  const [meetingContext, setMeetingContext] = useState<DocumentContextState>(() =>
    withSavedInstructions(emptyDocumentContextState(MEETING_CONTEXT_SECTIONS), "meeting"),
  );
  // Assistant Mode's own context, isolated from both of the above.
  const [assistantContext, setAssistantContext] = useState<DocumentContextState>(() =>
    withSavedInstructions(emptyDocumentContextState(ASSISTANT_CONTEXT_SECTIONS), "assistant"),
  );
  // Each custom mode's own context, keyed by its id — isolated like the above.
  const [customContexts, setCustomContexts] = useState<Record<string, DocumentContextState>>(() =>
    Object.fromEntries(loadCustomModes().map((m) => [m.id, initialCustomContext(m.id)])),
  );
  const customContextOf = useCallback(
    (id: string) => customContexts[id] ?? initialCustomContext(id),
    [customContexts],
  );
  const customContextSetter = useCallback(
    (id: string): Dispatch<SetStateAction<DocumentContextState>> =>
      (action) =>
        setCustomContexts((prev) => {
          const current = prev[id] ?? initialCustomContext(id);
          return { ...prev, [id]: typeof action === "function" ? action(current) : action };
        }),
    [],
  );
  const contextSections = selectedCustomMode
    ? customContextSections(selectedCustomMode.id)
    : usesAssistantContext
      ? ASSISTANT_CONTEXT_SECTIONS
      : isMeeting
        ? MEETING_CONTEXT_SECTIONS
        : INTERVIEW_CONTEXT_SECTIONS;
  const contextState = selectedCustomMode
    ? customContextOf(selectedCustomMode.id)
    : usesAssistantContext
      ? assistantContext
      : isMeeting
        ? meetingContext
        : interviewContext;
  const setContextState = selectedCustomMode
    ? customContextSetter(selectedCustomMode.id)
    : usesAssistantContext
      ? setAssistantContext
      : isMeeting
        ? setMeetingContext
        : setInterviewContext;
  const attachedMeetingSections = countFilledSections(
    MEETING_CONTEXT_SECTIONS.filter((s) => s.key !== INSTRUCTIONS_SECTION_KEY),
    meetingContext,
  );

  // Custom instructions are a standing preference, not per-session material
  // like an agenda — remember each mode's across app restarts.
  const interviewInstructions = interviewContext[INSTRUCTIONS_SECTION_KEY]?.text ?? "";
  const meetingInstructions = meetingContext[INSTRUCTIONS_SECTION_KEY]?.text ?? "";
  const assistantInstructions = assistantContext[INSTRUCTIONS_SECTION_KEY]?.text ?? "";
  useEffect(() => saveInstructions("interview", interviewInstructions), [interviewInstructions]);
  useEffect(() => saveInstructions("meeting", meetingInstructions), [meetingInstructions]);
  useEffect(() => saveInstructions("assistant", assistantInstructions), [assistantInstructions]);
  useEffect(() => {
    for (const [id, state] of Object.entries(customContexts)) {
      saveInstructions(customModeValue(id), state[INSTRUCTIONS_SECTION_KEY]?.text ?? "");
    }
  }, [customContexts]);

  // "updating" replaces the entire window with a small "Updating…" screen
  // (see the early return in the JSX below) — no banner, no button, no
  // installer window: found means installed, automatically. Tauri's
  // updater runs the NSIS installer silently on Windows and this only ever
  // needs to call relaunch() after, never showing that installer's own UI.
  // "failed" is the one visible outcome: a real problem (corrupt download,
  // disk full) falls through to the normal app rather than wedging the
  // user on a screen with no way forward, since Ask AI etc. still work
  // fine on the version already installed.
  const [updateState, setUpdateState] = useState<"idle" | "updating" | "failed">("idle");

  // Checked once per launch. A found update installs immediately with no
  // confirmation step — see the state doc above for why this is safe to do
  // silently rather than asking first.
  useEffect(() => {
    let cancelled = false;
    checkForUpdate().then(async (update) => {
      if (cancelled || !update) return;
      setUpdateState("updating");
      try {
        await installUpdate(update);
      } catch (err) {
        if (!cancelled) {
          console.error("auto-update failed:", err);
          setUpdateState("failed");
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Every AI feature requires a signed-in session now (no BYOK fallback) —
  // check once at startup and, if nothing is signed in, open the Account
  // panel automatically so login is the first thing a new/logged-out user
  // sees rather than a confusing failure the first time they click Start.
  useEffect(() => {
    let cancelled = false;
    getAuthSession()
      .then((session) => {
        if (cancelled) return;
        setAuthSession(session);
        if (!session.loggedIn) {
          setOpenPopover("ACCOUNT");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Retries syncing any interview transcript that's saved locally but never
  // confirmed reaching the dashboard (see history.rs's `synced` flag) — e.g.
  // an interview that ended while offline, or mid-sync when the app was
  // last killed. Runs once per launch, after sign-in is confirmed, so a
  // transcript that only made it to the local file still shows up on the
  // dashboard without the user having to do anything.
  useEffect(() => {
    if (!authSession?.loggedIn) return;
    invoke("resync_pending_interview_transcripts").catch((e) =>
      console.error("Failed to resync pending interview transcripts:", e),
    );
  }, [authSession?.loggedIn]);

  // A Test Audio run that was cut off (crash, quit, update) leaves its
  // session open on the server; close it as soon as we're signed in so the
  // next test or interview isn't blocked by it.
  useEffect(() => {
    if (!authSession?.loggedIn) return;
    invoke("close_orphaned_audio_test_session").catch(() => {});
  }, [authSession?.loggedIn]);

  // History/status content only has room to render once the user has
  // natively maximized/resized the window larger than its compact toolbar
  // footprint — there is no in-app expand control anymore, so this tracks
  // the OS window state directly instead of app state.
  useEffect(() => {
    const appWindow = getCurrentWindow();
    appWindow.isMaximized().then(setIsMaximized).catch(() => {});
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized).catch(() => {});
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Re-signals capture-exclusion readiness (see `signal_window_content_ready`
  // in Rust and the matching comment on the `interview-mode:overlay-closed`
  // listener above) on every focus gain, not just the one explicit event —
  // this window is shown+focused together from several different Rust call
  // sites (ending an interview, restoring from the floating bubble, the
  // single-instance relaunch handler), and focus is the one signal common to
  // all of them without needing a dedicated event wired from each. Cheap and
  // idempotent (`reconcile` on the Rust side no-ops when nothing's actually
  // changed), so firing on every focus rather than only "the interesting"
  // ones is fine.
  useEffect(() => {
    const unlistenPromise = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) {
        invoke("warm_backend").catch(() => {});
        requestAnimationFrame(() => {
          invoke("signal_window_content_ready").catch(() => {});
        });
      }
    });
    return () => {
      unlistenPromise.then((f) => f());
    };
  }, []);

  // Closing the main window (its own ✕, Alt+F4, etc.) hides Smallbird to the
  // system tray rather than quitting, so its global shortcuts keep working
  // (see tray.rs — "Quit Smallbird" in the tray menu is the real exit). Any
  // live session is still ended first, exactly as a real quit would:
  // capture stops and end_backend_session finalizes the metered session
  // (both safe/cheap no-ops when nothing is running). A true crash/force-
  // kill still can't run this; that's what the backend's stale-session
  // sweep is for.
  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlistenPromise = appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      try {
        await invoke("stop_audio_capture").catch(() => {});
        await invoke("end_backend_session");
      } catch {
        // Best-effort — never block closing over this.
      } finally {
        setSessionState("IDLE");
        setOpenPopover(null);
        await invoke("hide_to_tray");
      }
    });
    return () => {
      unlistenPromise.then((f) => f());
    };
  }, []);

  // The main window is `transparent: true` (tauri.conf.json) so the extra
  // height it grows into for an open header dropdown is genuinely
  // see-through rather than a visible grey panel — see App.css's
  // `.compact-transparent` rule. That transparency only makes sense in the
  // compact toolbar state (maximized view wants its normal opaque
  // background), so this marks/unmarks html+body the same way main.tsx
  // marks overlay windows, rather than via CSS :has().
  useEffect(() => {
    document.documentElement.classList.toggle("compact-transparent", !isMaximized);
    document.body.classList.toggle("compact-transparent", !isMaximized);
  }, [isMaximized]);

  // The overlay window (Interview Mode) and this main window are separate
  // webviews with no shared React state — ending a session from inside the
  // overlay (its own ✕ / "Yes, end interview" / Escape) has no way to reset
  // this window's Start/Stop button back to idle on its own. The Rust side
  // emits this event whenever an overlay closes, from whichever side
  // triggered it, so this listener is what keeps the two in sync instead of
  // requiring a redundant click on Stop here after already ending it there.
  useEffect(() => {
    const unlisten = listen("interview-mode:overlay-closed", () => {
      setSessionState("IDLE");
      if (shortcutStartingRef.current) shortcutStartCancelledRef.current = true;
      // Stop audio capture too, not only the backend session — before this,
      // capture (and its Deepgram stream) kept running after every session
      // ended, and the next session then reused that stale capture, still
      // tied to the previous session's key, so nothing got transcribed.
      invoke("stop_audio_capture").catch(() => {});
      // Closing the overlay via its own controls (✕ / "Yes, end interview" /
      // Escape) bypasses handleStop entirely, so this is the only place
      // that path ends the backend session — without it, the
      // interview_sessions row stays "active" until the 2-minute stale-
      // heartbeat sweep clears it, blocking a new session in the meantime.
      invoke("end_backend_session").catch(() => {});
      // (Capture-exclusion re-signaling for this reshow is handled by the
      // window-focus listener below, since `close_overlay_window` in Rust
      // always pairs `main.show()` with `main.set_focus()`.)
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // HeaderDropdown itself measures its real rendered height and resizes the
  // main window to match exactly on mount, then shrinks it back to 56px on
  // unmount (see HeaderDropdown.tsx) — so toggling here is just React
  // state; no resize call needed at this layer.
  const togglePopover = useCallback((p: Exclude<Popover, null>) => {
    setOpenPopover((cur) => (cur === p ? null : p));
  }, []);

  const closePopover = useCallback(() => setOpenPopover(null), []);
  const expandedPanel =
    openPopover === "CONTEXT" || openPopover === "SETTINGS" || (openPopover === "CUSTOM_MODE" && editingMode)
      ? openPopover
      : null;

  // The Test Audio result lives in the Interview details popover — closing it
  // ends any run in progress (releasing capture) and clears the old result.
  useEffect(() => {
    if (openPopover !== "START_SETUP") void audioTest.cancel();
  }, [openPopover, audioTest.cancel]);

  // Set only for the specific "you have an active session on another
  // device" case — distinct from `error` because it's a resolvable choice
  // (offer to end that session and continue here) rather than a dead end.
  const [activeElsewhereMessage, setActiveElsewhereMessage] = useState<string | null>(null);

  // A mode's own context panel — so a mode shortcut uploads that mode's
  // files/instructions, not those of whichever mode was selected before.
  const contextFor = useCallback(
    (mode: SessionMode) => {
      const customId = customModeId(mode);
      return customId
        ? ([customContextSections(customId), customContextOf(customId), customContextSetter(customId)] as const)
        : mode === "assistant" || mode === "notes"
          ? ([ASSISTANT_CONTEXT_SECTIONS, assistantContext, setAssistantContext] as const)
          : mode === "meeting"
            ? ([MEETING_CONTEXT_SECTIONS, meetingContext, setMeetingContext] as const)
            : ([INTERVIEW_CONTEXT_SECTIONS, interviewContext, setInterviewContext] as const);
    },
    [assistantContext, meetingContext, interviewContext, customContextOf, customContextSetter],
  );

  const startInterview = useCallback(
    async (force = false, showOverlay = true, mode?: SessionMode) => {
      const [sections, sectionState, setSectionState] = mode
        ? contextFor(mode)
        : ([contextSections, contextState, setContextState] as const);
      // A Test Audio run still in flight holds the capture device and its own
      // STT session — release both before the real interview claims them.
      await audioTest.cancel();

      // Start recording system audio right now, into a local buffer — the
      // session key and Deepgram connection below take a few seconds, and
      // nothing said in that time should be lost. A shortcut start already
      // began this on the key press (the call is then a no-op).
      await invoke("begin_audio_prebuffer").catch(() => {});

      // Awaited so extraction genuinely finishes — and interviewContext is
      // updated with the resulting status/documentId — before the overlay
      // opens and the first question can be asked. Previously this was
      // fire-and-forget, so a slow PDF extraction (or one that hadn't even
      // started yet) could lose the race against the interviewer's first
      // question, silently answering with no CV/JD context at all.
      // Files/screenshots already uploaded when they were added — this only
      // pushes typed text. A screenshot still being read when Start is
      // pressed needn't be waited on: Ask AI reads documents live, so it's
      // picked up on the first question after it finishes.
      // Run in parallel with the backend-session request below — they're
      // independent, and the session request is the slow part of starting.
      const uploadPromise = uploadDocumentContext(sections, sectionState);

      // Mints the session's Deepgram key and starts the metered
      // interview_sessions row server-side. Any rejection here (not logged
      // in, no remaining minutes, a network problem reaching the backend)
      // genuinely blocks Start — there is no local fallback anymore. An
      // active-session-elsewhere rejection is handled separately below
      // rather than thrown, since it's resolvable (see
      // activeElsewhereMessage). See start_backend_session's Rust-side doc
      // (BackendSessionResult) for the full contract.
      let sessionResult: { rejection: string | null; activeElsewhere: boolean };
      try {
        const [uploaded, result] = await Promise.all([
          uploadPromise,
          invoke<{ rejection: string | null; activeElsewhere: boolean }>("start_backend_session", { sttMode: "local", force }),
        ]);
        setSectionState(mergeTextUploads(uploaded));
        sessionResult = result;
      } catch (e) {
        // Offline / backend unreachable: nothing started server-side, but
        // the prebuffer above is still recording — don't leave it running.
        await invoke("stop_audio_capture").catch(() => {});
        throw e;
      }
      if (sessionResult.activeElsewhere || sessionResult.rejection) {
        // No session — discard what was recorded since the press.
        await invoke("stop_audio_capture").catch(() => {});
      }
      if (sessionResult.activeElsewhere) {
        setActiveElsewhereMessage(sessionResult.rejection);
        return false;
      }
      if (sessionResult.rejection) {
        throw new Error(sessionResult.rejection);
      }

      // A shortcut start cancelled while the session request was in flight:
      // never open capture — the caller ends the backend session it got.
      if (shortcutStartingRef.current && shortcutStartCancelledRef.current) return false;

      // Attaches speech-to-text to the recording begun above (its backlog is
      // sent first). Every session gets a fresh capture on its own Deepgram
      // key — begin_audio_prebuffer stopped any capture left from an earlier
      // session. The transcript is cleared by the start itself, before any
      // buffered speech is transcribed.
      try {
        await invoke("start_system_audio_capture");
        if (showOverlay) await invoke("show_interview_overlay");
      } catch (e) {
        // The backend session is live (and metered) at this point — end it
        // and release the capture, rather than leaving both running behind an
        // IDLE UI. Both calls are no-ops if nothing is running.
        await invoke("stop_audio_capture").catch(() => {});
        await invoke("end_backend_session").catch(() => {});
        throw e;
      }
      return true;
    },
    [contextSections, contextState, setContextState, contextFor, audioTest.cancel],
  );

  const handleStart = useCallback(async () => {
    setError(null);
    setActiveElsewhereMessage(null);
    setSessionState("STARTING");
    closePopover();
    setStartRole("");
    setStartCompany("");
    setStartMeetingTopic("");
    setStartParticipants("");
    try {
      const started = await startInterview();
      setSessionState(started ? "LISTENING" : "IDLE");
    } catch (e) {
      await showStartError(e);
      setSessionState("IDLE");
    }
  }, [startInterview, closePopover, showStartError]);

  // Company/role for the "Start Interview" details prompt (START_SETUP
  // popover below) — always starts blank so each interview gets its own
  // company/role instead of re-showing whatever was typed last time.
  // Persisted into OverlaySettings (the same store InterviewOverlay.tsx
  // reads role/company from to build the AI's prompt context) only once
  // Start is actually pressed, not on every keystroke.
  const [startRole, setStartRole] = useState("");
  const [startCompany, setStartCompany] = useState("");
  // Meeting Mode's start details — all optional, so a meeting can start
  // straight away; whatever is filled in helps the AI follow the meeting.
  const [startMeetingTopic, setStartMeetingTopic] = useState("");
  const [startParticipants, setStartParticipants] = useState("");

  const handleConfirmStart = useCallback(async () => {
    const current = loadOverlaySettings();
    if (isMeeting) {
      saveOverlaySettings({
        ...current,
        mode: "meeting",
        role: "",
        company: "",
        meetingTopic: startMeetingTopic.trim(),
        participants: startParticipants.trim(),
      });
    } else {
      saveOverlaySettings({
        ...current,
        mode: "interview",
        role: startRole.trim(),
        company: startCompany.trim(),
        meetingTopic: "",
        participants: "",
      });
    }
    await handleStart();
  }, [isMeeting, startRole, startCompany, startMeetingTopic, startParticipants, handleStart]);

  // Assistant and custom modes have nothing to set up — Start begins right away.
  const handleImmediateStart = useCallback(async () => {
    const current = loadOverlaySettings();
    saveOverlaySettings({ ...current, mode: sessionMode, role: "", company: "", meetingTopic: "", participants: "" });
    await handleStart();
  }, [handleStart, sessionMode]);

  const openNewCustomMode = useCallback(() => {
    setEditingMode({ mode: { id: newCustomModeId(), name: "", role: "", listenTo: "call" }, isNew: true });
    setOpenPopover("CUSTOM_MODE");
  }, []);

  const openEditCustomMode = useCallback((mode: CustomMode) => {
    setEditingMode({ mode, isNew: false });
    setOpenPopover("CUSTOM_MODE");
  }, []);

  const selectMode = useCallback((mode: SessionMode) => {
    setSessionMode(mode);
    saveSessionMode(mode);
    // Stored for the overlay right away: a shortcut start shows the overlay
    // (which reads this) before the main window gets to save anything.
    saveOverlaySettings({ ...loadOverlaySettings(), mode });
  }, []);

  // A different account signing in starts in Interview, not the previous
  // account's mode (see claimSessionModeFor).
  useEffect(() => {
    if (!authSession?.loggedIn || !authSession.email) return;
    if (claimSessionModeFor(authSession.email) && sessionStateRef.current === "IDLE") selectMode("interview");
  }, [authSession?.loggedIn, authSession?.email, selectMode]);

  // Drops a mode's context and everything it uploaded.
  const discardCustomContext = useCallback((id: string) => {
    setCustomContexts((prev) => {
      const state = prev[id];
      if (state) {
        for (const section of Object.values(state)) {
          if (section.textDocumentId) invoke("delete_document", { documentId: section.textDocumentId }).catch(() => {});
          for (const a of section.attachments) {
            if (a.documentId) invoke("delete_document", { documentId: a.documentId }).catch(() => {});
          }
        }
      }
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
    forgetInstructions(customModeValue(id));
  }, []);

  const handleSaveCustomMode = useCallback(
    (mode: CustomMode) => {
      setCustomModes((prev) =>
        prev.some((m) => m.id === mode.id) ? prev.map((m) => (m.id === mode.id ? mode : m)) : [...prev, mode],
      );
      // A new mode is selected right away — that's why it was made.
      if (editingMode?.isNew) selectMode(customModeValue(mode.id));
      setEditingMode(null);
      setOpenPopover(null);
    },
    [editingMode?.isNew, selectMode],
  );

  const handleCancelCustomMode = useCallback(() => {
    // A mode that was never created leaves nothing behind.
    if (editingMode?.isNew) discardCustomContext(editingMode.mode.id);
    setEditingMode(null);
    setOpenPopover(null);
  }, [editingMode, discardCustomContext]);

  const handleDeleteCustomMode = useCallback(() => {
    if (!editingMode) return;
    const { id } = editingMode.mode;
    setCustomModes((prev) => prev.filter((m) => m.id !== id));
    discardCustomContext(id);
    if (sessionMode === customModeValue(id)) selectMode("assistant");
    setEditingMode(null);
    setOpenPopover(null);
  }, [editingMode, discardCustomContext, sessionMode, selectMode]);

  // Closing the panel any other way (Esc, clicking away) counts as Cancel.
  useEffect(() => {
    if (openPopover !== "CUSTOM_MODE" && editingMode) handleCancelCustomMode();
  }, [openPopover, editingMode, handleCancelCustomMode]);

  // An out-of-minutes message goes away by itself once there are minutes
  // again (e.g. right after buying more on the website): while it's showing,
  // the balance is re-checked every 15s and whenever this window regains
  // focus. Nothing is polled when no such message is up.
  const outOfMinutesShowing = isOutOfMinutesMessage(error);
  useEffect(() => {
    if (!outOfMinutesShowing) return;
    let cancelled = false;
    const check = () => {
      getEntitlement()
        .then((info) => {
          if (!cancelled && info.remainingMinutes > 0) {
            setError((current) => (isOutOfMinutesMessage(current) ? null : current));
          }
        })
        .catch(() => {});
    };
    const timer = window.setInterval(check, 15000);
    const unlistenFocus = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) check();
    });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unlistenFocus.then((f) => f());
    };
  }, [outOfMinutesShowing]);

  // Settings → Sessions → "Continue this session": a new live session in
  // that session's mode and details, with its conversation loaded into the
  // overlay (the AI gets the recent turns as context, and new turns are
  // saved into the same session).
  const handleContinueSession = useCallback(
    async (entry: HistoryEntry) => {
      if (sessionStateRef.current !== "IDLE") {
        setError("End the current session before continuing another one.");
        return;
      }
      const { mode, role, company, meetingTopic } = sessionDetails(entry);
      sessionStateRef.current = "STARTING";
      setSessionMode(mode);
      saveSessionMode(mode);
      saveOverlaySettings({ ...loadOverlaySettings(), mode, role, company, meetingTopic, participants: "" });
      // The mode's audio defaults before recording starts (the effect that
      // normally sends these runs only after the mode change renders).
      await invoke("set_source_defaults", sourceDefaults(mode)).catch(() => {});
      closePopover();
      setError(null);
      setActiveElsewhereMessage(null);
      setSessionState("STARTING");
      try {
        const started = await startInterview(false, true, mode);
        if (started) {
          await emit("overlay:resume-session", entry);
          setSessionState("LISTENING");
        } else {
          setSessionState("IDLE");
        }
      } catch (e) {
        await showStartError(e);
        setSessionState("IDLE");
      }
    },
    [startInterview, closePopover, showStartError],
  );

  // "Skip" on the details prompt — must also clear any role/company saved
  // from a *previous* interview. Without this, skipping just reused
  // whatever was last saved via handleConfirmStart (the only other writer
  // of these fields), so an old company kept showing up on interviews
  // where the user deliberately chose not to set one this time.
  const handleSkipStart = useCallback(async () => {
    const current = loadOverlaySettings();
    saveOverlaySettings({ ...current, mode: "interview", role: "", company: "", meetingTopic: "", participants: "" });
    await handleStart();
  }, [handleStart]);

  // "End other session & continue" from the activeElsewhereMessage banner.
  const handleForceStart = useCallback(async () => {
    setActiveElsewhereMessage(null);
    setError(null);
    setSessionState("STARTING");
    try {
      await startInterview(true);
      setSessionState("LISTENING");
    } catch (e) {
      await showStartError(e);
      setSessionState("IDLE");
    }
  }, [startInterview, showStartError]);

  // The backend force-ended this device's session because the same account
  // logged in and started a new one elsewhere (see start_backend_session's
  // `force` option) — without this listener the local UI would just sit on
  // "Listening" indefinitely while Deepgram itself eventually drops the now-
  // revoked connection, with no explanation shown.
  useEffect(() => {
    const unlisten = listen<string>("stt:session-ended-elsewhere", (event) => {
      setError(event.payload);
      setSessionState("IDLE");
      invoke("stop_audio_capture").catch(() => {});
      invoke("hide_interview_overlay").catch(() => {});
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Mid-session failures the overlay also shows — mirrored here so they're
  // visible when the session was started without the overlay, or once the
  // user comes back to the main window. The session is left running: the
  // user decides when to stop (capture may still recover on its own).
  useEffect(() => {
    const unlistenStt = listen<string>("stt:error", (event) => setError(event.payload));
    const unlistenCapture = listen<string>("audio:capture-error", (event) =>
      setError(`Stopped hearing audio: ${event.payload}`),
    );
    return () => {
      unlistenStt.then((f) => f());
      unlistenCapture.then((f) => f());
    };
  }, []);

  const handleStop = useCallback(async () => {
    try {
      await invoke("hide_interview_overlay");
    } catch (e) {
      setError(String(e));
    } finally {
      setSessionState("IDLE");
      // Fire-and-forget: finalizes the backend session (if one was
      // started) so its minutes get decremented. Never blocks Stop and
      // never surfaces an error to the user — a network blip here must
      // not cost the user the interview they just finished. No-ops
      // silently when the user isn't signed in (see start_backend_session).
      invoke("stop_audio_capture")
        .catch(() => {})
        .finally(() => invoke("end_backend_session").catch(() => {}));
    }
  }, []);

  // The overlay shortcut, when no session is running (see shortcuts.rs's
  // toggle_session): starts one exactly like Start — same context, backend
  // session and capture — reusing the last start details and the header's
  // current mode. The overlay is shown first so the press feels instant
  // (it reads "Starting…" until capture reports Recording). Only this
  // explicit press starts anything; pressing the shortcut again closes the
  // overlay, which ends the session.
  const startFromShortcut = useCallback(async (requestedMode?: SessionMode) => {
    const mode = requestedMode ?? sessionMode;
    if (sessionStateRef.current !== "IDLE") {
      invoke("shortcut_session_settled").catch(() => {});
      return;
    }
    // Claimed right away (the state below only reaches the ref on the next
    // render), so a second start request arriving meanwhile can't also start.
    sessionStateRef.current = "STARTING";
    // Sign-in may not be restored yet right after launch — ask again rather
    // than trusting a startup check that ran before it was.
    let signedIn = authSession?.loggedIn === true;
    if (!signedIn) {
      const fresh = await getAuthSession().catch(() => null);
      if (fresh) setAuthSession(fresh);
      signedIn = fresh?.loggedIn === true;
    }
    if (!signedIn) {
      sessionStateRef.current = "IDLE";
      invoke("shortcut_session_settled").catch(() => {});
      await invoke("hide_interview_overlay").catch(() => {});
      invoke("restore_from_bubble").catch(() => {});
      setOpenPopover("ACCOUNT");
      return;
    }
    const current = loadOverlaySettings();
    saveOverlaySettings({ ...current, mode });
    setError(null);
    setActiveElsewhereMessage(null);
    setOpenPopover(null);
    setSessionState("STARTING");
    shortcutStartingRef.current = true;
    shortcutStartCancelledRef.current = false;
    try {
      // The overlay is already showing — shortcuts.rs shows it on the key
      // press itself, before this event even arrives.
      const started = await startInterview(false, false, mode);
      if (shortcutStartCancelledRef.current) {
        // Closed while starting — undo whatever did start.
        await invoke("stop_audio_capture").catch(() => {});
        await invoke("end_backend_session").catch(() => {});
        setSessionState("IDLE");
        return;
      }
      if (!started) {
        // Active on another device: show the main window's choice.
        await invoke("hide_interview_overlay").catch(() => {});
        await invoke("restore_from_bubble").catch(() => {});
        setSessionState("IDLE");
        return;
      }
      setSessionState("LISTENING");
    } catch (e) {
      await showStartError(e);
      await invoke("hide_interview_overlay").catch(() => {});
      await invoke("stop_audio_capture").catch(() => {});
      await invoke("end_backend_session").catch(() => {});
      await invoke("restore_from_bubble").catch(() => {});
      setSessionState("IDLE");
    } finally {
      shortcutStartingRef.current = false;
      invoke("shortcut_session_settled").catch(() => {});
    }
  }, [authSession?.loggedIn, sessionMode, startInterview, showStartError]);

  const startFromShortcutRef = useRef(startFromShortcut);
  startFromShortcutRef.current = startFromShortcut;
  useEffect(() => {
    // Payload: the mode a mode shortcut asked for, or null for "the
    // selected mode". A mode shortcut also switches the header to that mode.
    const unlisten = listen<SessionMode | null>("shortcut:start-session", (event) => {
      const mode = event.payload ?? undefined;
      if (mode) {
        setSessionMode(mode);
        saveSessionMode(mode);
      }
      void startFromShortcutRef.current(mode);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const startLabel =
    sessionState === "STARTING"
      ? "Starting…"
      : sessionState === "LISTENING"
        ? "Listening"
        : "Start";

  // A real OS minimize would leave no way back in: the main window is
  // `skip_taskbar` (tauri.conf.json), so there'd be no taskbar entry to
  // restore it from. Collapsing to the floating logo bubble instead keeps a
  // visible, clickable way back — see bubble_window.rs.
  const handleMinimize = useCallback(() => {
    invoke("minimize_to_bubble");
  }, []);
  const handleToggleMaximize = useCallback(() => {
    getCurrentWindow().toggleMaximize();
  }, []);
  const handleClose = useCallback(() => {
    getCurrentWindow().close();
  }, []);

  return (
    <main
      className={`app-shell ${isMaximized ? "" : "app-shell-compact"}${expandedPanel ? " panel-expanded" : ""}`}
    >
      <div className="title-bar" data-tauri-drag-region>
        <div className="window-controls">
          <button className="window-control-btn" onClick={handleMinimize} aria-label="Minimize" title="Minimize">
            <IconMinimize />
          </button>
          <button
            className="window-control-btn"
            onClick={handleToggleMaximize}
            aria-label={isMaximized ? "Restore" : "Maximize"}
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? <IconRestore /> : <IconMaximize />}
          </button>
          <button className="window-control-btn close" onClick={handleClose} aria-label="Close" title="Close">
            <IconClose />
          </button>
        </div>
      </div>

      <header className="compact-header">
        <div className="compact-header-brand">
          <img className="header-logo" src={smallbirdLogo} alt="Smallbird" />
          <span className="header-product">
            SmallBird
            <sup style={{ fontSize: "0.55em", fontWeight: 400, marginLeft: "1px" }}>™</sup>
          </span>
          {/* The only visible sign an update is happening — everything else
              (Start, Ask AI once in a session, etc.) keeps working normally
              while this downloads/installs in the background. The app
              process itself gets replaced the moment installUpdate's
              relaunch() call fires, so this never needs a "done" state of
              its own — it just disappears along with everything else when
              the new version's window comes up. */}
          {updateState === "updating" && (
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginLeft: "4px" }}
              title="Downloading and installing the latest version"
            >
              <Spinner className="on-light" />
              <span style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>Updating…</span>
            </span>
          )}
        </div>

        <div className="compact-header-controls">
          <div className="dropdown-anchor">
            <button
              className="compact-header-btn"
              onClick={() => togglePopover("MODEL")}
              disabled={sessionState !== "IDLE"}
              aria-haspopup="menu"
              aria-expanded={openPopover === "MODEL"}
              title="Which AI model answers your questions"
            >
              {(() => {
                const current = LLM_PROVIDERS.find((p) => p.value === llmProvider)!;
                const CurrentIcon = current.icon;
                return (
                  <>
                    <CurrentIcon size={14} />
                    <span>{current.label}</span>
                  </>
                );
              })()}
              <IconChevronDown />
            </button>
            {openPopover === "MODEL" && (
              <HeaderDropdown onClose={closePopover} className="header-dropdown-menu header-dropdown-model">
                <div role="menu">
                  {LLM_PROVIDERS.map((p) => (
                    <button
                      key={p.value}
                      role="menuitemradio"
                      aria-checked={llmProvider === p.value}
                      disabled={!p.available}
                      className={`dropdown-item dropdown-item-icon${llmProvider === p.value ? " active" : ""}`}
                      title={p.available ? undefined : "Coming soon"}
                      onClick={() => {
                        if (!p.available) return;
                        setLlmProvider(p.value);
                        saveLlmProvider(p.value);
                        closePopover();
                      }}
                    >
                      <p.icon size={16} />
                      <span>{p.label}</span>
                      {!p.available && <span className="dropdown-item-badge">Soon</span>}
                    </button>
                  ))}
                </div>
              </HeaderDropdown>
            )}
          </div>

          <div className="dropdown-anchor">
            <button
              className="compact-header-btn"
              onClick={() => togglePopover("MODE")}
              disabled={sessionState !== "IDLE"}
              aria-haspopup="menu"
              aria-expanded={openPopover === "MODE"}
              title="Interview, meeting, personal assistant or your own custom mode — changes what Start asks for and how the AI answers"
            >
              <span className="mode-button-label">{modeLabel(sessionMode, customModes)}</span>
              <IconChevronDown />
            </button>
            {openPopover === "MODE" && (
              <HeaderDropdown onClose={closePopover} className="header-dropdown-menu header-dropdown-model">
                <div role="menu">
                  {SESSION_MODES.map((m) => (
                    <button
                      key={m.value}
                      role="menuitemradio"
                      aria-checked={sessionMode === m.value}
                      className={`dropdown-item${sessionMode === m.value ? " active" : ""}`}
                      title={m.description}
                      onClick={() => {
                        selectMode(m.value);
                        closePopover();
                      }}
                    >
                      <span>{m.label}</span>
                    </button>
                  ))}
                  {customModes.length > 0 && <div className="dropdown-divider" role="separator" />}
                  {customModes.map((m) => {
                    const value = customModeValue(m.id);
                    return (
                      <div key={m.id} className="dropdown-item-row">
                        <button
                          role="menuitemradio"
                          aria-checked={sessionMode === value}
                          className={`dropdown-item${sessionMode === value ? " active" : ""}`}
                          title={m.role || m.name}
                          onClick={() => {
                            selectMode(value);
                            closePopover();
                          }}
                        >
                          <span>{m.name}</span>
                        </button>
                        <button
                          className="dropdown-item-edit"
                          onClick={() => openEditCustomMode(m)}
                          aria-label={`Edit ${m.name}`}
                          title="Edit mode"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                  <div className="dropdown-divider" role="separator" />
                  <button role="menuitem" className="dropdown-item dropdown-item-create" onClick={openNewCustomMode}>
                    + Create custom mode
                  </button>
                </div>
              </HeaderDropdown>
            )}
          </div>

          <div className="dropdown-anchor">
            <button
              className="compact-header-btn icon"
              onClick={() => togglePopover("CONTEXT")}
              title="Context"
              aria-haspopup="dialog"
              aria-expanded={openPopover === "CONTEXT"}
            >
              <IconAttachment />
              <span>Context</span>
            </button>
          </div>

          {sessionState === "LISTENING" ? (
            <Button variant="danger" onClick={handleStop}>
              Stop
            </Button>
          ) : (
            <div className="dropdown-anchor">
              <Button
                variant="primary"
                onClick={() => (startsImmediately ? handleImmediateStart() : togglePopover("START_SETUP"))}
                disabled={sessionState === "STARTING" || authSession?.loggedIn === false}
                title={authSession?.loggedIn === false ? "Log in from the Account panel to start" : undefined}
                aria-haspopup="dialog"
                aria-expanded={openPopover === "START_SETUP"}
              >
                {/* The STT model load behind Start can take a couple of
                    seconds (cold-starting the sidecar process + loading the
                    ONNX model) — a static label made that wait look frozen.
                    This spinner is the only signal the user has that anything
                    is happening until the overlay itself opens. */}
                {sessionState === "STARTING" ? (
                  <span className="btn-spinner">
                    <Spinner />
                    {startLabel}
                  </span>
                ) : (
                  startLabel
                )}
              </Button>
              {openPopover === "START_SETUP" && (
                <HeaderDropdown onClose={closePopover} className="header-dropdown-panel header-dropdown-wide header-dropdown-start">
                  <div className="popover-overlay">
                    <div className="popover" role="dialog" aria-label={isMeeting ? "Meeting context" : "Interview details"}>
                      <div className="popover-header">
                        <span className="setup-section-label">{isMeeting ? "Meeting Context" : "Interview details"}</span>
                        <button className="modal-close-btn" onClick={closePopover} aria-label="Close">
                          ✕
                        </button>
                      </div>
                      {isMeeting ? (
                        <div className="popover-body start-setup-body">
                          <div className="setup-identity-field">
                            <label className="setup-section-label" htmlFor="start-setup-meeting-topic">
                              What is this meeting about? <span className="setup-section-optional">Optional</span>
                            </label>
                            <input
                              id="start-setup-meeting-topic"
                              className="setup-input"
                              type="text"
                              value={startMeetingTopic}
                              placeholder="e.g. Client discussion about endpoint security"
                              autoFocus
                              onChange={(e) => setStartMeetingTopic(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && handleConfirmStart()}
                            />
                          </div>
                          <div className="setup-identity-field">
                            <label className="setup-section-label" htmlFor="start-setup-participants">
                              Participants <span className="setup-section-optional">Optional</span>
                            </label>
                            <input
                              id="start-setup-participants"
                              className="setup-input"
                              type="text"
                              value={startParticipants}
                              placeholder="e.g. Priya (client CTO), Rahul"
                              onChange={(e) => setStartParticipants(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && handleConfirmStart()}
                            />
                          </div>
                          <div className="setup-identity-field">
                            <label className="setup-section-label">
                              Add context <span className="setup-section-optional">Optional</span>
                              {attachedMeetingSections > 0 && (
                                <span className="setup-section-status setup-section-status-ready">
                                  {" "}
                                  {attachedMeetingSections} added
                                </span>
                              )}
                            </label>
                            <div className="meeting-context-actions">
                              <Button variant="secondary" size="sm" onClick={() => setOpenPopover("CONTEXT")}>
                                📄 Documents & screenshots
                              </Button>
                              <Button variant="secondary" size="sm" onClick={() => setOpenPopover("CONTEXT")}>
                                📋 Add agenda
                              </Button>
                              <Button variant="secondary" size="sm" onClick={() => setOpenPopover("CONTEXT")}>
                                🧠 Knowledge base
                              </Button>
                            </div>
                          </div>
                          <AudioTestStatus state={audioTest.state} busy={audioTest.busy} onRetry={audioTest.start} />
                        </div>
                      ) : (
                      <div className="popover-body start-setup-body">
                        <div className="setup-identity-field">
                          <label className="setup-section-label" htmlFor="start-setup-company">
                            Company
                          </label>
                          <CompanySelect id="start-setup-company" value={startCompany} onChange={setStartCompany} />
                        </div>
                        <div className="setup-identity-field">
                          <label className="setup-section-label" htmlFor="start-setup-role">
                            Role
                          </label>
                          <input
                            id="start-setup-role"
                            className="setup-input"
                            type="text"
                            value={startRole}
                            placeholder="e.g. Senior Frontend Engineer"
                            onChange={(e) => setStartRole(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleConfirmStart()}
                          />
                        </div>
                        <p className="setup-hint">
                          Helps the AI tailor answers to this interview. Optional — Skip to start without it.
                        </p>
                        <AudioTestStatus state={audioTest.state} busy={audioTest.busy} onRetry={audioTest.start} />
                      </div>
                      )}
                      <div className="popover-footer">
                        <Button
                          variant="secondary"
                          className="audio-test-btn"
                          onClick={audioTest.start}
                          disabled={audioTest.busy || sessionState !== "IDLE"}
                          title="Check that Smallbird can hear and transcribe your meeting audio"
                        >
                          {audioTest.state.phase === "listening" || audioTest.state.phase === "connecting" ? "🔴 Listening..." : "🔊 Test Audio"}
                        </Button>
                        {!isMeeting && (
                          <Button variant="ghost" onClick={handleSkipStart}>
                            Skip
                          </Button>
                        )}
                        <Button
                          variant="primary"
                          onClick={handleConfirmStart}
                        >
                          {isMeeting ? "Start Meeting" : "Start Interview"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </HeaderDropdown>
              )}
            </div>
          )}

          <div className="dropdown-anchor">
            <button
              className="compact-header-btn icon"
              onClick={() => togglePopover("SETTINGS")}
              title="Settings"
              aria-label="Settings"
              aria-haspopup="dialog"
              aria-expanded={openPopover === "SETTINGS"}
            >
              <IconSettings />
            </button>
          </div>

          <div className="dropdown-anchor">
            <button
              className="compact-header-btn icon"
              onClick={() => togglePopover("ACCOUNT")}
              title={authSession?.loggedIn && authSession.email ? authSession.email : "Account"}
              aria-label="Account"
              aria-haspopup="dialog"
              aria-expanded={openPopover === "ACCOUNT"}
            >
              {authSession?.loggedIn && authSession.email ? (
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "18px",
                    height: "18px",
                    borderRadius: "50%",
                    background: colorForEmail(authSession.email),
                    color: "#fff",
                    fontSize: "10px",
                    fontWeight: 600,
                    lineHeight: 1,
                  }}
                >
                  {authSession.email.charAt(0).toUpperCase()}
                </span>
              ) : (
                <IconAccount />
              )}
            </button>
            {openPopover === "ACCOUNT" && (
              <HeaderDropdown onClose={closePopover} className="header-dropdown-panel">
                <Account onClose={closePopover} onSessionChange={setAuthSession} />
              </HeaderDropdown>
            )}
          </div>
        </div>
      </header>

      {/* Context and Settings open as part of the bar itself — it expands
          downward to fit them and collapses back when closed (see
          ExpandPanel), rather than as separate floating popups. */}
      <ExpandPanel panelKey={expandedPanel} onClose={closePopover}>
        {expandedPanel === "SETTINGS" ? (
          <SettingsPopover
            onClose={closePopover}
            onContinueSession={handleContinueSession}
            sessionRunning={sessionState !== "IDLE"}
          />
        ) : expandedPanel === "CUSTOM_MODE" && editingMode ? (
          <CustomModeEditor
            key={editingMode.mode.id}
            mode={editingMode.mode}
            isNew={editingMode.isNew}
            contextState={customContextOf(editingMode.mode.id)}
            onContextChange={customContextSetter(editingMode.mode.id)}
            isLive={sessionState !== "IDLE" && sessionMode === customModeValue(editingMode.mode.id)}
            onSave={handleSaveCustomMode}
            onCancel={handleCancelCustomMode}
            onDelete={handleDeleteCustomMode}
          />
        ) : (
          <div className="popover" role="dialog" aria-label="Context">
            <div className="popover-header">
              <span className="setup-section-label">
                {selectedCustomMode
                  ? `${selectedCustomMode.name} context`
                  : isAssistant
                    ? "Assistant context"
                    : isMeeting
                      ? "Meeting context"
                      : "Interview context"}
              </span>
              <button className="modal-close-btn" onClick={closePopover} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="popover-body">
              <DocumentContext
                sections={contextSections}
                state={contextState}
                onChange={setContextState}
                isLive={sessionState === "LISTENING"}
              />
            </div>
            {isMeeting && sessionState === "IDLE" && (
              <div className="popover-footer">
                <Button variant="primary" onClick={() => setOpenPopover("START_SETUP")}>
                  Back to meeting setup
                </Button>
              </div>
            )}
          </div>
        )}
      </ExpandPanel>

      {activeElsewhereMessage ? (
        <div className="error compact-header-error" style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span>{activeElsewhereMessage}</span>
          <Button variant="danger" onClick={handleForceStart}>
            End other session &amp; continue
          </Button>
          <Button variant="ghost" onClick={() => setActiveElsewhereMessage(null)}>
            Cancel
          </Button>
        </div>
      ) : (
        error &&
        (isOutOfMinutesMessage(error) ? (
          <div className="error compact-header-error error-with-action">
            <span>{error.replace(/^Error:\s*/, "")}</span>
            <Button variant="primary" size="sm" className="upgrade-btn" onClick={() => invoke("open_upgrade").catch(showStartError)}>
              Upgrade
            </Button>
          </div>
        ) : (
          <p className="error compact-header-error">{error.replace(/^Error:\s*/, "")}</p>
        ))
      )}

      {isMaximized && (
        <div className="expanded-content">
          <LowEndHardwareBanner />
        </div>
      )}
    </main>
  );
}

export default App;
