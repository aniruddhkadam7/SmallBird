import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { COUNTRY_COOKIE } from "@/lib/currency";

// Keeps the Supabase session cookie fresh on every request — without this,
// an access token nearing expiry would eventually make server-side reads
// (like the download page's entitlement check) start failing even though
// the user is still validly logged in.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  await supabase.auth.getUser();

  // Visitor's country for showing local prices (lib/currency.ts). Pages are
  // static, so the browser reads it from this cookie before first paint.
  const country = request.headers.get("x-vercel-ip-country");
  if (country && request.cookies.get(COUNTRY_COOKIE)?.value !== country) {
    response.cookies.set(COUNTRY_COOKIE, country, { path: "/", maxAge: 60 * 60 * 24 * 30, sameSite: "lax" });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
