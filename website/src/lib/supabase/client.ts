import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client, backed by cookies (not localStorage) so the
// same session is readable server-side too — see server.ts. Used by the
// purchase flow's signup step and anywhere else the website needs the
// signed-in user's own session client-side.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
