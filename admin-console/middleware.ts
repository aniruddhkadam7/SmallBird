// UX convenience only: redirects a browser with no Supabase session to
// /login and refreshes the session cookie on every request. This is NOT the
// security boundary -- it says nothing about whether a signed-in user is
// actually an admin. Every admin-* Edge Function independently re-verifies
// the caller's JWT and checks the admin_users allowlist server-side on
// every single request, regardless of what this middleware does.
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    },
  );

  // getSession() reads (and if needed refreshes) the cookie session locally;
  // getUser() would add a round-trip to Supabase Auth on every navigation and
  // prefetch, which made tab switches noticeably slow. That's fine here since
  // this check is only a redirect convenience (see above).
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const signedIn = !!session;

  const isLoginPage = request.nextUrl.pathname.startsWith("/login");
  // The recovery link's session hash (#access_token=...) only gets applied
  // client-side after this page loads -- there's no cookie yet on this
  // first server-rendered request, so this route must be allowed through
  // with no session, same as /login.
  const isResetPasswordPage = request.nextUrl.pathname.startsWith("/reset-password");

  if (!signedIn && !isLoginPage && !isResetPasswordPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (signedIn && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Static images (the logo, app/icon.png favicon) and the home-screen
  // manifest must load on /login too, so they skip the signed-out redirect.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$).*)"],
};
