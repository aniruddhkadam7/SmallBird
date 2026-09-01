import { invoke } from "@tauri-apps/api/core";

// Thin wrappers around the Deepgram API-key Tauri commands (see
// src-tauri/src/stt/commands.rs) — same Windows Credential Manager storage
// mechanism as personalApiKeys.ts, just for the single STT provider rather
// than an LLM provider.

export function getDeepgramApiKey(): Promise<string | null> {
  return invoke<string | null>("stt_get_api_key");
}

export function setDeepgramApiKey(key: string): Promise<void> {
  return invoke<void>("stt_set_api_key", { key });
}

export function clearDeepgramApiKey(): Promise<void> {
  return invoke<void>("stt_clear_api_key");
}
