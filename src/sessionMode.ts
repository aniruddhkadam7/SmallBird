// Which kind of session Start begins — chosen from the main header's mode
// dropdown (App.tsx). Interview Mode answers as a job candidate using the
// resume/JD; Meeting Mode answers as the user taking part in a meeting using
// the meeting's purpose/agenda/documents; Assistant Mode is the user's own
// general-purpose assistant (personal use — no interview or meeting
// framing at all); Notes Mode takes no AI part at all — it writes down who
// said what in a meeting (both sides heard, the call split by speaker);
// "custom:<id>" is a mode the user created themselves
// (customModes.ts). The overlay itself doesn't read
// this key: the mode in effect is snapshotted into OverlaySettings when Start
// is pressed, so switching the dropdown later can't change a live session.

import { findCustomMode } from "./customModes";

export type SessionMode = "interview" | "meeting" | "assistant" | "notes" | `custom:${string}`;

const STORAGE_KEY = "smallbird:session-mode";
// Which account the saved mode belongs to. The saved mode lives on the
// computer, not the account, so without this a new account signing in on a
// computer someone already used would start in their last mode instead of
// Interview.
const OWNER_KEY = "smallbird:session-mode-owner";

/// Call once the signed-in email is known. Returns true when `email` is a
/// different account from the one the saved mode belongs to -- the caller
/// then switches to Interview. The first account seen on a computer keeps
/// whatever mode it already had.
export function claimSessionModeFor(email: string): boolean {
  try {
    const owner = window.localStorage.getItem(OWNER_KEY);
    window.localStorage.setItem(OWNER_KEY, email);
    return owner !== null && owner !== email;
  } catch {
    return false;
  }
}

export function saveSessionMode(mode: SessionMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // localStorage unavailable — the choice just won't persist across restarts.
  }
}

export function loadSessionMode(): SessionMode {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "meeting" || saved === "assistant" || saved === "notes") return saved;
    // A custom mode only while it still exists (it may have been deleted).
    if (saved?.startsWith("custom:") && findCustomMode(saved as SessionMode)) return saved as SessionMode;
    return "interview";
  } catch {
    return "interview";
  }
}
