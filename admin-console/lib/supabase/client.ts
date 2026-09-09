// Browser-side Supabase client. Only ever configured with the public anon
// key -- the service-role key is never referenced anywhere in this app; it
// lives exclusively in Supabase Edge Function secrets, used by the admin-*
// functions this app calls.
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
