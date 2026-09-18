"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { callAdminFunction, AdminApiError } from "@/lib/adminApi";

function toDateInputValue(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function GrantPassPanel({ userId, onSuccess }: { userId: string; onSuccess: () => void }) {
  const [minutes, setMinutes] = useState("");
  const [startAt, setStartAt] = useState(toDateInputValue(new Date()));
  const [expiresAt, setExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const minutesNum = Number(minutes);
  const canSubmit =
    minutes.trim() !== "" && Number.isFinite(minutesNum) && minutesNum >= 0 && expiresAt !== "" && reason.trim().length > 0;

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Session expired -- please sign in again.");

      await callAdminFunction(session.access_token, "admin-grant-pass", {
        targetUserId: userId,
        minutes: minutesNum,
        startAt: new Date(startAt).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        reason: reason.trim(),
        note: note.trim() || undefined,
      });

      setMinutes("");
      setExpiresAt("");
      setReason("");
      setNote("");
      setOpen(false);
      onSuccess();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Failed to grant pass");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary w-full">
        Grant a time-limited pass
      </button>
    );
  }

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-ink">Grant pass</h2>
      <p className="mt-1 text-xs text-muted">
        Free trial, bonus minutes, or promotional access with a defined expiration -- separate from a plain balance
        correction, so it shows up in the audit log as GRANT_PASS.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Minutes to grant</label>
          <input type="number" min={0} step="0.1" value={minutes} onChange={(e) => setMinutes(e.target.value)} className="input" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Start date</label>
            <input type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="input" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Expires</label>
            <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="input" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Reason (required, audited)</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="input" placeholder="e.g. Promotional trial" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Internal note (optional)</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} className="input" rows={2} />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex gap-2">
          <button type="button" disabled={!canSubmit || loading} onClick={submit} className="btn-primary flex-1">
            {loading ? "Granting..." : "Grant pass"}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="btn-secondary flex-1">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
