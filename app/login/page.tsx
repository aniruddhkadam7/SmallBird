"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { callAdminFunction, AdminApiError } from "@/lib/adminApi";
import Image from "next/image";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError || !data.session) {
      setError(signInError?.message ?? "Sign-in failed");
      setLoading(false);
      return;
    }

    // Authorization is decided server-side, never here: this call is the
    // first real proof the signed-in account is actually on the admin
    // allowlist. A valid Supabase login that isn't an admin gets 403'd here
    // and is immediately signed back out.
    try {
      await callAdminFunction(data.session.access_token, "admin-record-login");
    } catch (err) {
      await supabase.auth.signOut();
      if (err instanceof AdminApiError && err.status === 403) {
        setError("This account is not authorized for the admin console.");
      } else {
        setError("Could not verify admin access. Please try again.");
      }
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/3 rounded-full bg-accent/20 blur-3xl"
      />
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="relative w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="relative mb-4 flex h-16 w-16 items-center justify-center">
            <div aria-hidden className="absolute inset-0 rounded-2xl bg-accent/15 blur-lg" />
            <Image
              src="/smallbird-mark.png"
              alt="Smallbird"
              width={56}
              height={56}
              priority
              className="relative h-14 w-14 drop-shadow-sm"
            />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Smallbird Admin</h1>
          <p className="mt-1.5 text-sm text-muted">Internal console &middot; authorized staff only</p>
        </div>
        <form onSubmit={handleSubmit} className="card space-y-4 sm:p-6">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              className="input"
              placeholder="you@smallbird.in"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-muted">Every action here is written to the audit log.</p>
      </div>
    </div>
  );
}
