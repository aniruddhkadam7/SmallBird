// Same public, client-safe identifiers the desktop app and the website use
// (src-tauri/src/auth/client.rs) — the anon key is not a secret.
export const SUPABASE_URL = "https://xubbwgrjvvsbfvxcuzav.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1YmJ3Z3JqdnZzYmZ2eGN1emF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NzQ5NjAsImV4cCI6MjEwMjQ1MDk2MH0.ZBkDqETqfJFcrmx68wQCqE2RsfvDwyy_k7uJvlY3vJo";

export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// Same model the desktop app's Ask AI uses for OpenAI (personal/client.rs).
export const LLM_MODEL = "gpt-4o";
