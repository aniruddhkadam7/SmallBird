"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function ChangePasswordPanel() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setPassword("");
    setConfirm("");
    setDone(true);
  }

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-ink">Change password</h2>
      <form onSubmit={handleSubmit} className="mt-3 space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">New password</label>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Confirm</label>
          <input
            type="password"
            required
            autoComplete="new-password"
            className="input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        {done && <p className="text-sm text-ok">Password updated.</p>}
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "Saving..." : "Update password"}
        </button>
      </form>
    </div>
  );
}
