import { useState, type FormEvent } from "react";
import { requestOtp, verifyOtp } from "./api";
import type { AuthSession } from "./session";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login({ onSignedIn }: { onSignedIn: (session: AuthSession) => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) return setError("Enter a valid email address.");
    setBusy(true);
    setError("");
    try {
      await requestOtp(trimmed);
      setEmail(trimmed);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{4}$/.test(code)) return setError("Enter the 4-digit code from your email.");
    setBusy(true);
    setError("");
    try {
      onSignedIn(await verifyOtp(email, code));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't work.");
      setBusy(false);
    }
  }

  return (
    <main className="screen center">
      <h1 className="brand">SmallBird AI</h1>
      <p className="muted">Sign in to start. Use the same email as your SmallBird AI account.</p>

      {!sent ? (
        <form onSubmit={submitEmail} className="stack">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <button className="primary" disabled={busy}>
            {busy ? "Sending…" : "Email me a code"}
          </button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="stack">
          <p className="muted">We sent a 4-digit code to {email}.</p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={4}
            placeholder="0000"
            className="code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            autoFocus
          />
          <button className="primary" disabled={busy}>
            {busy ? "Checking…" : "Sign in"}
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              setSent(false);
              setCode("");
              setError("");
            }}
          >
            Use a different email
          </button>
        </form>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  );
}
