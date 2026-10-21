// Modes the user creates themselves, next to the built-in Interview, Meeting
// and Assistant modes in the header's mode dropdown. Each one has a name, a
// "how to act" role (the AI's persona for the mode), which audio it listens
// to by default, and its own Context sections — custom instructions plus
// documents/notes — under document types keyed by the mode's id, so no two
// modes ever share uploads. A custom mode's session mode is "custom:<id>";
// the Rust side (interview_mode/commands.rs's build_ask_request) runs it on
// Assistant Mode's pipeline with the role in place of the assistant persona.

import type { DocumentContextSection } from "./DocumentContext";
import { INSTRUCTIONS_SECTION_KEY } from "./headerPopups";
import type { SessionMode } from "./sessionMode";

export type CustomModeListenTo = "call" | "mic";

export interface CustomMode {
  id: string;
  name: string;
  /// How the AI should act in this mode — who it is, who it speaks as, tone.
  role: string;
  /// What a new session hears by default: the call/computer audio (like
  /// Interview/Meeting) or the user's own mic (like Assistant).
  listenTo: CustomModeListenTo;
}

const STORAGE_KEY = "smallbird:custom-modes";

export const MAX_CUSTOM_MODE_NAME = 40;

export function loadCustomModes(): CustomMode[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m): m is CustomMode => typeof m?.id === "string" && m.id !== "" && typeof m?.name === "string")
      .map((m) => ({
        id: m.id,
        name: m.name,
        role: typeof m.role === "string" ? m.role : "",
        listenTo: m.listenTo === "mic" ? "mic" : "call",
      }));
  } catch {
    return [];
  }
}

export function saveCustomModes(modes: CustomMode[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(modes));
  } catch {
    // localStorage unavailable — the modes just won't survive a restart.
  }
}

export function newCustomModeId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export function customModeValue(id: string): SessionMode {
  return `custom:${id}`;
}

export function customModeId(mode: SessionMode): string | null {
  return mode.startsWith("custom:") ? mode.slice("custom:".length) || null : null;
}

export function findCustomMode(mode: SessionMode, modes: CustomMode[] = loadCustomModes()): CustomMode | null {
  const id = customModeId(mode);
  return id ? (modes.find((m) => m.id === id) ?? null) : null;
}

/// Whether a new session in `mode` starts on the user's mic (call audio off)
/// rather than the call audio (mic off).
export function listensToMic(mode: SessionMode, modes?: CustomMode[]): boolean {
  if (mode === "assistant") return true;
  return findCustomMode(mode, modes)?.listenTo === "mic";
}

/// What a new session in `mode` hears, sent to the backend as
/// `set_source_defaults`. Notes Mode hears both sides — the user's mic is
/// "You" and the call audio is split by speaker (`diarize`).
export function sourceDefaults(
  mode: SessionMode,
  modes?: CustomMode[],
): { system: boolean; mic: boolean; diarize: boolean } {
  if (mode === "notes") return { system: true, mic: true, diarize: true };
  const mic = listensToMic(mode, modes);
  return { system: !mic, mic, diarize: false };
}

export function customContextSections(id: string): DocumentContextSection[] {
  return [
    {
      key: INSTRUCTIONS_SECTION_KEY,
      documentType: `CUSTOM_INSTRUCTIONS:${id}`,
      label: "Custom instructions",
      textOnly: true,
      placeholder: "Rules for every answer — e.g. Keep replies under 3 lines, always mention our 30-day refund policy",
    },
    {
      key: "context",
      documentType: `CUSTOM_CONTEXT:${id}`,
      label: "Documents & notes",
      description: "Docs, knowledge base, FAQs, scripts, screenshots — what the AI should know in this mode.",
    },
  ];
}
