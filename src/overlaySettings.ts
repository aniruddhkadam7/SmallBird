// Interview Mode overlay settings — persisted to localStorage so they
// survive between sessions without needing the backend or the large
// Record/Prepare dashboard. Kept in its own module (rather than inline in
// InterviewOverlay.tsx) so the shape is easy to share with the settings
// panel component and to unit-test in isolation.

import type { SessionMode } from "./sessionMode";

export type AnswerLength = "brief" | "default" | "detailed";
export type ResponseStyle = "natural" | "technical" | "concise";
export type OverlayDensity = "compact" | "comfortable";
export type OverlaySize = "small" | "medium" | "large";
export type EnglishLevel = "simple" | "professional" | "advanced";
export type Humanization = "natural" | "conversational" | "formal";

export interface OverlaySettings {
  opacity: number; // 0.15 - 1.0 — alpha of the overlay's panel background
  size: OverlaySize;
  fontSize: number; // px, 12 - 20
  density: OverlayDensity;
  answerLength: AnswerLength;
  responseStyle: ResponseStyle;
  role: string;
  company: string;
  jobDescription: string;
  englishLevel: EnglishLevel;
  humanization: Humanization;
  // When on, a completed interviewer question is sent to Ask AI automatically
  // a short debounce after the interviewer stops talking — see the
  // transcript:update listener in InterviewOverlay.tsx. Off by default so
  // existing behavior (manual Ask AI / Enter) is unchanged until opted in.
  autoAI: boolean;
  // Whether the overlay asks Windows to exclude it from screen captures
  // (WDA_EXCLUDEFROMCAPTURE). On by default. Some legacy screen-share/
  // screenshot pipelines still render an excluded window as a solid black
  // rectangle instead of properly hiding it — that's a Windows-level
  // fallback no app can override — so this exists for a candidate who'd
  // rather have the overlay plainly visible than show as an unexplained
  // black box on someone else's screen.
  captureProtection: boolean;
  // Snapshot of the header's mode dropdown (sessionMode.ts) taken when Start
  // is pressed, plus Meeting Mode's own start details. Interview sessions
  // leave meetingTopic/participants blank; meeting sessions leave
  // role/company blank.
  mode: SessionMode;
  meetingTopic: string;
  participants: string;
}

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  opacity: 0.8,
  size: "large",
  fontSize: 14,
  density: "comfortable",
  answerLength: "detailed",
  responseStyle: "natural",
  role: "",
  company: "",
  jobDescription: "",
  englishLevel: "simple",
  humanization: "natural",
  autoAI: false,
  captureProtection: true,
  mode: "interview",
  meetingTopic: "",
  participants: "",
};

/// Fraction of the primary monitor's shorter dimension the overlay window
/// occupies for each Small/Medium/Large choice. Shared between the settings
/// panel (which resizes on change) and the overlay's mount effect (which
/// applies the user's saved choice to a freshly created window) so the two
/// can never drift apart. Must track `DEFAULT_SIZE_FRACTION` in
/// `interview_mode/window.rs` for the "large" entry, since that Rust constant
/// is what a brand-new window uses before either of these ever runs.
export const SIZE_FRACTIONS: Record<OverlaySize, number> = {
  small: 0.45,
  medium: 0.6,
  large: 0.75,
};

const STORAGE_KEY = "interview-mode:overlay-settings";

// Bumped when a stored value would otherwise keep an old default alive.
//
// v2: the opacity slider used to bottom out at 0.4 and default to 0.82, back
// when the overlay also ran a backdrop blur and could never be properly
// see-through anyway.
// v3: default opacity moved to 0.8 and default size to "large" — a user who
// never touched either setting should land on the new defaults, not be stuck
// on whatever v1/v2 happened to write to disk.
// v4: added englishLevel/answerStyle/humanization (New Interview setup
// page's Answer Style controls) — purely additive, no migration needed since
// loadOverlaySettings() already merges stored settings over the defaults.
// v5: default answer length changed from "default" to "detailed", and the
// dead answerStyle field (nothing in the UI ever set it) was dropped — see
// migration below, same "only move what the user never touched" heuristic
// v3 used for opacity/size.
const SETTINGS_VERSION = 5;
const MIN_USABLE_OPACITY = 0.15;

export function loadOverlaySettings(): OverlaySettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_OVERLAY_SETTINGS };
    const parsed = JSON.parse(raw);
    // Merge over the defaults rather than trusting the stored shape outright,
    // so a settings schema added in a later version doesn't leave new fields
    // undefined for a user who saved settings under an older version.
    const merged: OverlaySettings = { ...DEFAULT_OVERLAY_SETTINGS, ...parsed };
    const storedVersion = parsed?.version ?? 1;

    if (storedVersion < 2) {
      merged.opacity = DEFAULT_OVERLAY_SETTINGS.opacity;
    }
    if (storedVersion < 3) {
      // Only move settings the user never touched — someone who deliberately
      // picked "small" or dragged opacity to 40% should keep that choice, not
      // get silently overridden by a change to what the defaults are.
      if (parsed?.opacity === 0.55) merged.opacity = DEFAULT_OVERLAY_SETTINGS.opacity;
      if (parsed?.size === "medium" || parsed?.size === undefined) {
        merged.size = DEFAULT_OVERLAY_SETTINGS.size;
      }
    }
    if (storedVersion < 5 && (parsed?.answerLength === "default" || parsed?.answerLength === undefined)) {
      merged.answerLength = DEFAULT_OVERLAY_SETTINGS.answerLength;
    }
    // Clamp regardless of provenance — a hand-edited or corrupted value of 0
    // would render an invisible overlay the user cannot find to fix.
    merged.opacity = Math.min(1, Math.max(MIN_USABLE_OPACITY, merged.opacity));

    return merged;
  } catch {
    return { ...DEFAULT_OVERLAY_SETTINGS };
  }
}

export function saveOverlaySettings(settings: OverlaySettings): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...settings, version: SETTINGS_VERSION }),
    );
  } catch {
    // localStorage unavailable (e.g. disabled) — settings simply won't
    // persist across restarts; not worth surfacing an error for.
  }
}
