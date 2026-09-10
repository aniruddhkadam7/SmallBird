import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import "./App.css";
import smallbirdLogo from "./assets/smallbird-logo.png";
import {
  DocumentContext,
  emptyDocumentContextState,
  uploadDocumentContext,
  type DocumentContextState,
} from "./DocumentContext";
import { Account } from "./Account";
import { SettingsPopover } from "./SettingsPopover";
import { LowEndHardwareBanner } from "./LowEndHardwareBanner";
import { HeaderDropdown } from "./HeaderDropdown";
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
import { INTERVIEW_CONTEXT_SECTIONS } from "./headerPopups";
import { loadLlmProvider, saveLlmProvider, type LlmProvider } from "./llmProviderSetting";
import { getAuthSession, type AuthSessionInfo } from "./auth";
import { checkForUpdate, installUpdate } from "./autoUpdate";

type SessionState = "IDLE" | "STARTING" | "LISTENING";
type Popover = "MODEL" | "CONTEXT" | "SETTINGS" | "ACCOUNT" | "START_SETUP" | null;

// Only "openai" and "anthropic" have a real backend implementation (see
// backend/supabase/functions/llm-proxy's PROVIDER_URLS). "gemini" was
// dropped when this build switched from BYOK to backend-metered (llm-proxy
// has no Gemini support); "deepseek" is listed so the dropdown shows it but
// stays disabled until a provider is actually built for it.
const LLM_PROVIDERS: { value: LlmProvider; label: string; icon: typeof IconOpenAI; available: boolean }[] = [
  { value: "anthropic", label: "Anthropic", icon: IconAnthropic, available: true },
  { value: "openai", label: "OpenAI", icon: IconOpenAI, available: true },
  { value: "deepseek", label: "DeepSeek", icon: IconDeepSeek, available: false },
];

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
  const [openPopover, setOpenPopover] = useState<Popover>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  const [interviewContext, setInterviewContext] = useState<DocumentContextState>(() =>
    emptyDocumentContextState(INTERVIEW_CONTEXT_SECTIONS),
  );

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
        requestAnimationFrame(() => {
          invoke("signal_window_content_ready").catch(() => {});
        });
      }
    });
    return () => {
      unlistenPromise.then((f) => f());
    };
  }, []);

  // Closing the main window (its own ✕, Alt+F4, etc.) previously just quit
  // without ever telling the backend — same class of bug as the overlay's
  // own close controls, but for the whole app. Intercepting the close lets
  // this run one best-effort end_backend_session call first (safe/cheap to
  // call even when no session is active — see end_backend_session's Rust
  // doc) before actually closing. A true crash/force-kill still can't run
  // this; that's what the backend's stale-session sweep is for.
  //
  // Ends with quit_app (Rust-side app.exit(0)) rather than
  // appWindow.destroy(): once Interview Mode's overlay window has been
  // opened at least once this session, it's only ever hidden afterward,
  // never destroyed (see overlay_window.rs) — destroying just the main
  // window left that hidden, skip_taskbar window alive and the whole
  // process running invisibly in the background instead of actually
  // quitting, which read as "the close button doesn't do anything."
  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlistenPromise = appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      try {
        await invoke("end_backend_session");
      } catch {
        // Best-effort — never block the app from closing over this.
      } finally {
        await invoke("quit_app");
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

  // Set only for the specific "you have an active session on another
  // device" case — distinct from `error` because it's a resolvable choice
  // (offer to end that session and continue here) rather than a dead end.
  const [activeElsewhereMessage, setActiveElsewhereMessage] = useState<string | null>(null);

  const startInterview = useCallback(
    async (force = false) => {
      // Awaited so extraction genuinely finishes — and interviewContext is
      // updated with the resulting status/documentId — before the overlay
      // opens and the first question can be asked. Previously this was
      // fire-and-forget, so a slow PDF extraction (or one that hadn't even
      // started yet) could lose the race against the interviewer's first
      // question, silently answering with no CV/JD context at all.
      const uploaded = await uploadDocumentContext(INTERVIEW_CONTEXT_SECTIONS, interviewContext);
      setInterviewContext(uploaded);

      // Mints the session's Deepgram key and starts the metered
      // interview_sessions row server-side. Any rejection here (not logged
      // in, no remaining minutes, a network problem reaching the backend)
      // genuinely blocks Start — there is no local fallback anymore. An
      // active-session-elsewhere rejection is handled separately below
      // rather than thrown, since it's resolvable (see
      // activeElsewhereMessage). See start_backend_session's Rust-side doc
      // (BackendSessionResult) for the full contract.
      const sessionResult = await invoke<{ rejection: string | null; activeElsewhere: boolean }>(
        "start_backend_session",
        { sttMode: "local", force },
      );
      if (sessionResult.activeElsewhere) {
        setActiveElsewhereMessage(sessionResult.rejection);
        return false;
      }
      if (sessionResult.rejection) {
        throw new Error(sessionResult.rejection);
      }

      await invoke("start_system_audio_capture").catch((e) => {
        if (String(e) !== "capture already running") throw e;
      });
      await invoke("clear_transcript").catch(() => {});
      await invoke("show_interview_overlay");
      return true;
    },
    [interviewContext],
  );

  const handleStart = useCallback(async () => {
    setError(null);
    setActiveElsewhereMessage(null);
    setSessionState("STARTING");
    closePopover();
    setStartRole("");
    setStartCompany("");
    try {
      const started = await startInterview();
      setSessionState(started ? "LISTENING" : "IDLE");
    } catch (e) {
      setError(String(e));
      setSessionState("IDLE");
    }
  }, [startInterview, closePopover]);

  // Company/role for the "Start Interview" details prompt (START_SETUP
  // popover below) — always starts blank so each interview gets its own
  // company/role instead of re-showing whatever was typed last time.
  // Persisted into OverlaySettings (the same store InterviewOverlay.tsx
  // reads role/company from to build the AI's prompt context) only once
  // Start is actually pressed, not on every keystroke.
  const [startRole, setStartRole] = useState("");
  const [startCompany, setStartCompany] = useState("");

  const handleConfirmStart = useCallback(async () => {
    const current = loadOverlaySettings();
    saveOverlaySettings({ ...current, role: startRole.trim(), company: startCompany.trim() });
    await handleStart();
  }, [startRole, startCompany, handleStart]);

  // "Skip" on the details prompt — must also clear any role/company saved
  // from a *previous* interview. Without this, skipping just reused
  // whatever was last saved via handleConfirmStart (the only other writer
  // of these fields), so an old company kept showing up on interviews
  // where the user deliberately chose not to set one this time.
  const handleSkipStart = useCallback(async () => {
    const current = loadOverlaySettings();
    saveOverlaySettings({ ...current, role: "", company: "" });
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
      setError(String(e));
      setSessionState("IDLE");
    }
  }, [startInterview]);

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
      invoke("end_backend_session").catch(() => {});
    }
  }, []);

  const startLabel =
    sessionState === "STARTING" ? "Starting…" : sessionState === "LISTENING" ? "Listening" : "Start";

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
    <main className={`app-shell ${isMaximized ? "" : "app-shell-compact"}`}>
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
              className="compact-header-btn icon"
              onClick={() => togglePopover("CONTEXT")}
              title="Context"
              aria-haspopup="dialog"
              aria-expanded={openPopover === "CONTEXT"}
            >
              <IconAttachment />
              <span>Context</span>
            </button>
            {openPopover === "CONTEXT" && (
              <HeaderDropdown onClose={closePopover} className="header-dropdown-panel header-dropdown-wide">
                <div className="popover-overlay">
                  <div className="popover" role="dialog" aria-label="Context">
                    <div className="popover-header">
                      <span className="setup-section-label">Attach context</span>
                      <button className="modal-close-btn" onClick={closePopover} aria-label="Close">
                        ✕
                      </button>
                    </div>
                    <div className="popover-body">
                      <DocumentContext
                        sections={INTERVIEW_CONTEXT_SECTIONS}
                        state={interviewContext}
                        onChange={setInterviewContext}
                        isLive={sessionState === "LISTENING"}
                      />
                    </div>
                  </div>
                </div>
              </HeaderDropdown>
            )}
          </div>

          {sessionState === "LISTENING" ? (
            <Button variant="danger" onClick={handleStop}>
              Stop
            </Button>
          ) : (
            <div className="dropdown-anchor">
              <Button
                variant="primary"
                onClick={() => togglePopover("START_SETUP")}
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
                <HeaderDropdown onClose={closePopover} className="header-dropdown-panel header-dropdown-wide">
                  <div className="popover-overlay">
                    <div className="popover" role="dialog" aria-label="Interview details">
                      <div className="popover-header">
                        <span className="setup-section-label">Interview details</span>
                        <button className="modal-close-btn" onClick={closePopover} aria-label="Close">
                          ✕
                        </button>
                      </div>
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
                      </div>
                      <div className="popover-footer">
                        <Button variant="ghost" onClick={handleSkipStart}>
                          Skip
                        </Button>
                        <Button variant="primary" onClick={handleConfirmStart}>
                          Start Interview
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
            {openPopover === "SETTINGS" && (
              <HeaderDropdown onClose={closePopover} className="header-dropdown-panel header-dropdown-settings">
                <SettingsPopover onClose={closePopover} />
              </HeaderDropdown>
            )}
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
        error && <p className="error compact-header-error">{error}</p>
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
