// Which kind of session Start begins — chosen from the main header's mode
// dropdown (App.tsx). Interview Mode answers as a job candidate using the
// resume/JD; Meeting Mode answers as the user taking part in a meeting using
// the meeting's purpose/agenda/documents; Assistant Mode is the user's own
// general-purpose assistant (personal use — no interview or meeting
// framing at all). The overlay itself doesn't read
// this key: the mode in effect is snapshotted into OverlaySettings when Start
// is pressed, so switching the dropdown later can't change a live session.

export type SessionMode = "interview" | "meeting" | "assistant";

const STORAGE_KEY = "smallbird:session-mode";

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
    return saved === "meeting" || saved === "assistant" ? saved : "interview";
  } catch {
    return "interview";
  }
}
