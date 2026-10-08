"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { callAdminFunction, AdminApiError } from "@/lib/adminApi";

interface Props {
  userId: string;
  isBanned: boolean;
  banReason: string | null;
  bannedAt: string | null;
  bannedByEmail: string | null;
  onSuccess: () => void;
}

export function BanUserPanel({ userId, isBanned, banReason, bannedAt, bannedByEmail, onSuccess }: Props) {
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Session expired — please sign in again.");

      await callAdminFunction(session.access_token, "admin-ban-user", {
        targetUserId: userId,
        action: isBanned ? "UNBAN" : "BAN",
        reason: isBanned ? (reason.trim() || "Admin unbanned user") : reason.trim(),
      });

      setReason("");
      setConfirming(false);
      onSuccess();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Failed to apply");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={`card border-2 ${isBanned ? "border-danger/30 bg-danger/5" : "border-border"}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">{isBanned ? "User is banned" : "Ban user"}</h2>
        {isBanned && <span className="badge badge-danger">Banned</span>}
      </div>

      {isBanned && (
        <div className="mt-2 space-y-1 text-xs text-muted">
          {banReason && <p>Reason: <span className="text-ink">{banReason}</span></p>}
          {bannedAt && <p>Banned on {new Date(bannedAt).toLocaleString()}</p>}
          {bannedByEmail && <p>Banned by {bannedByEmail}</p>}
        </div>
      )}

      {!isBanned && (
        <p className="mt-1 text-xs text-muted">
          Banning blocks all new session starts and AI calls for this user. Active sessions continue
          until they end naturally.
        </p>
      )}

      <div className="mt-4 space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">
            {isBanned ? "Reason for unbanning (optional)" : "Reason for banning (required, audited)"}
          </label>
          <textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setConfirming(false);
            }}
            className="input"
            rows={2}
            placeholder={isBanned ? "e.g. Appeal accepted" : "e.g. Repeated abuse of free tier, multiple accounts"}
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        {!confirming ? (
          <button
            type="button"
            disabled={loading || (!isBanned && reason.trim().length === 0)}
            onClick={() => setConfirming(true)}
            className={`w-full ${isBanned ? "btn-primary" : "bg-danger text-white hover:opacity-90 rounded-lg px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-40"}`}
          >
            {isBanned ? "Unban user" : "Ban user"}
          </button>
        ) : (
          <div className="rounded-lg border border-border bg-subtle p-3">
            <p className="text-sm font-semibold text-ink">
              {isBanned ? "Unban this user?" : "Ban this user?"}
            </p>
            <p className="mt-1 text-xs text-muted">This action is written to the audit log.</p>
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={loading} onClick={submit} className="btn-primary flex-1">
                {loading ? "Applying…" : "Confirm"}
              </button>
              <button type="button" disabled={loading} onClick={() => setConfirming(false)} className="btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
