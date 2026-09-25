import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type ShortcutAction = "toggleOverlay" | "toggleMainWindow";

interface ShortcutBindings {
  toggleOverlay: string | null;
  toggleMainWindow: string | null;
}

const ACTIONS: { key: ShortcutAction; label: string; description: string; defaultLabel: string }[] = [
  {
    key: "toggleOverlay",
    label: "Show / hide overlay",
    description: "Opens or hides the Smallbird overlay (the answer window you use during a session).",
    defaultLabel: "Ctrl + Shift + Space",
  },
  {
    key: "toggleMainWindow",
    label: "Show / hide Smallbird",
    description: "Brings the main Smallbird window forward, or tucks it back into the floating bubble.",
    defaultLabel: "none",
  },
];

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

/// Turns a keydown into the accelerator string the Rust side registers
/// (e.g. "Ctrl+Shift+K"), or null while only modifiers are held. Uses
/// `e.code` (the physical key) so the result doesn't depend on keyboard
/// layout or on Shift changing the character.
function acceleratorFromEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_CODES.has(e.code)) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  const key = e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : e.code;
  return [...mods, key].join("+");
}

/// A global shortcut takes its combination away from every other app, so a
/// single-modifier one (Ctrl+Z, Ctrl+C, Alt+Tab…) would break undo/copy/
/// window switching everywhere. Allowed: two or more of Ctrl/Alt/Shift, the
/// Win key with anything, or a function key. Same rule as `check_safe` in
/// shortcuts.rs.
function isSafeCombo(e: KeyboardEvent): boolean {
  if (/^F\d{1,2}$/.test(e.code) || e.metaKey) return true;
  return [e.ctrlKey, e.altKey, e.shiftKey].filter(Boolean).length >= 2;
}

/// Live "Ctrl + Alt + …" readout while modifiers are held, so the field
/// visibly reacts even before the final key lands.
function heldModifiers(e: KeyboardEvent): string {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Win");
  return mods.join(" + ");
}

const RECORDING_HINT =
  "Press two modifier keys plus a key (e.g. Ctrl + Shift + K), or an F-key (Fn + F9 works too). Esc cancels. If nothing shows up, Windows or another app already owns that combination — try a different one.";

/// Volume/media/brightness-style keys a laptop's top row sends when its Fn
/// lock is off. Registering those globally would hijack volume/playback.
const MEDIA_CODE = /^(Audio|Media|Launch|Browser|Brightness|Power|Sleep|WakeUp|Eject)/;

function displayAccelerator(accelerator: string): string {
  return accelerator
    .split("+")
    .map((part) => (part === "Super" ? "Win" : part.replace(/^Arrow/, "")))
    .join(" + ");
}

/// Settings → Shortcuts: pick the global keyboard shortcuts that open the
/// overlay or the main Smallbird window from anywhere. Bindings live on the
/// Rust side (`shortcuts.rs`, persisted to shortcuts.json) so they're
/// active from app launch, before this panel ever renders.
export function ShortcutsPanel() {
  const [bindings, setBindings] = useState<ShortcutBindings | null>(null);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [held, setHeld] = useState("");

  useEffect(() => {
    invoke<ShortcutBindings>("get_shortcuts")
      .then(setBindings)
      .catch((e) => setError(String(e)));
  }, []);

  const apply = useCallback(async (action: ShortcutAction, accelerator: string | null, reset = false) => {
    setError(null);
    try {
      setBindings(await invoke<ShortcutBindings>("set_shortcut", { action, accelerator, reset }));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const stopRecording = useCallback(() => {
    setRecording(null);
    setHint(null);
    setHeld("");
    invoke("suspend_shortcuts", { suspended: false }).catch(() => {});
  }, []);

  const startRecording = useCallback((action: ShortcutAction) => {
    setError(null);
    setHint(null);
    setHeld("");
    setRecording(action);
    // Pause existing shortcuts so pressing an already-bound combination to
    // re-assign it doesn't also fire it.
    invoke("suspend_shortcuts", { suspended: true }).catch(() => {});
  }, []);

  // Capture phase on window, so this sees the keys before anything else —
  // in particular before the Settings dropdown's own Escape-to-close
  // listener, which must not fire while a shortcut is being recorded.
  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        stopRecording();
        return;
      }
      // Fn itself never reaches Windows (the keyboard handles it in
      // hardware), and some laptop keys — brightness, keyboard backlight —
      // arrive with no usable key code at all. Say so instead of silently
      // doing nothing.
      if (!e.code || e.code === "Unidentified" || e.code === "Fn" || e.key === "Fn") {
        setHint(
          "That key can't be used — Fn and some laptop keys are handled by the keyboard itself. Fn + F1–F12 works: it records as the plain F-key.",
        );
        return;
      }
      if (MEDIA_CODE.test(e.code)) {
        setHint(
          "That's a media key (your Fn lock may be on). Hold Fn and press the F-key again to record it as a plain F-key, or use a Ctrl + Shift combination.",
        );
        return;
      }
      const accelerator = acceleratorFromEvent(e);
      if (!accelerator) {
        setHeld(heldModifiers(e));
        return;
      }
      if (!isSafeCombo(e)) {
        setHint(
          `${displayAccelerator(accelerator)} would stop working in every other app. Use two modifier keys, like Ctrl + Shift + K.`,
        );
        setHeld("");
        return;
      }
      const action = recording;
      setRecording(null);
      setHint(null);
      setHeld("");
      // Save first, *then* switch the other shortcuts back on — resuming in
      // parallel raced the save and re-registered the old combination.
      void apply(action, accelerator).finally(() => {
        invoke("suspend_shortcuts", { suspended: false }).catch(() => {});
      });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setHeld(heldModifiers(e));
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [recording, apply, stopRecording]);

  // Leaving Settings mid-recording must not leave every shortcut paused.
  useEffect(() => () => void invoke("suspend_shortcuts", { suspended: false }).catch(() => {}), []);

  return (
    <div className="shortcuts-panel">
      <p className="setup-hint" style={{ margin: 0 }}>
        Keyboard shortcuts that work from anywhere, even while another app is in front.
      </p>
      {error && <p className="error">{error}</p>}
      {ACTIONS.map((a) => {
        const current = bindings?.[a.key] ?? null;
        const isRecording = recording === a.key;
        return (
          <div className="shortcut-row" key={a.key}>
            <div className="shortcut-row-text">
              <span className="shortcut-row-label">{a.label}</span>
              <span className="setup-hint shortcut-row-description">{a.description}</span>
            </div>
            <div className="shortcut-row-controls">
              <button
                type="button"
                className={`shortcut-field${isRecording ? " recording" : ""}`}
                onClick={() => (isRecording ? stopRecording() : startRecording(a.key))}
                title={isRecording ? "Press Esc to cancel" : "Click, then press the keys you want"}
              >
                {isRecording
                  ? held
                    ? `${held} + …`
                    : "Press keys…"
                  : current
                    ? displayAccelerator(current)
                    : "Not set"}
              </button>
              <div className="shortcut-row-links">
                {current && (
                  <button className="link-button" onClick={() => apply(a.key, null)}>
                    Clear
                  </button>
                )}
                <button
                  className="link-button"
                  onClick={() => apply(a.key, null, true)}
                  title={`Default: ${a.defaultLabel}`}
                >
                  Reset
                </button>
              </div>
            </div>
            {isRecording && <p className="setup-hint shortcut-row-hint">{hint ?? RECORDING_HINT}</p>}
          </div>
        );
      })}
    </div>
  );
}
