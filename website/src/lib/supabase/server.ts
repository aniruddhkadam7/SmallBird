import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side Supabase client for Route Handlers and Server Components —
// reads the signed-in user's session from cookies (set by the browser
// client) and applies RLS as that user, no service-role key needed for a
// plain "read my own row" case like the download page's entitlement check.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component that can't set cookies — fine
            // as long as middleware.ts is refreshing the session too.
          }
        },
      },
    },
  );
}
