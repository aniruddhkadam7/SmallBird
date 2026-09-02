// The user's chosen AI model provider, set from the main header's dropdown
// (App.tsx) and read by the overlay window when it sends an ask request —
// a plain localStorage key, since the main window and overlay are separate
// webviews with no shared React state.

export type LlmProvider = "anthropic" | "openai" | "gemini" | "deepseek";

const STORAGE_KEY = "smallbird:llm-provider";
// Defaults to OpenAI rather than Anthropic since that's the provider with a
// funded key set as a Supabase secret so far — switch back once an
// ANTHROPIC_API_KEY secret is set, or just pick Anthropic from the header
// dropdown once it's available.
const DEFAULT_PROVIDER: LlmProvider = "openai";

// Only providers with a real backend implementation are ever sent on the
// wire (see apps/backend/app/schemas/ask.py's LlmProviderChoice) — "gemini"/
// "deepseek" are selectable in principle by this type, but the header
// dropdown keeps them disabled until a provider exists, so in practice this
// never resolves to one of them today.
export function saveLlmProvider(provider: LlmProvider): void {
  window.localStorage.setItem(STORAGE_KEY, provider);
}

export function loadLlmProvider(): LlmProvider {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === "anthropic" || raw === "openai" || raw === "gemini" || raw === "deepseek") {
    return raw;
  }
  return DEFAULT_PROVIDER;
}

// True once the user (or auto-detection) has actually picked a provider —
// distinct from loadLlmProvider() always resolving to DEFAULT_PROVIDER when
// nothing is stored yet. Lets App.tsx tell "never chosen" apart from
// "explicitly chose the default", so auto-detection only runs once.
export function hasStoredLlmProvider(): boolean {
  return window.localStorage.getItem(STORAGE_KEY) !== null;
}
