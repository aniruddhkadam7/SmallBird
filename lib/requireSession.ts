import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Server Component helper: gets the current session's access token for
// calling admin-* functions, or bounces to /login. Like the middleware, this
// is a UX convenience -- it does not decide whether the user is an admin.
// Every admin-* call independently re-verifies that server-side.
export async function requireSession() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}
