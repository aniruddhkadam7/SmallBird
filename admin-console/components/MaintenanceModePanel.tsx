"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { callAdminFunction, AdminApiError } from "@/lib/adminApi";

interface SettingMeta {
  value: string;
  description: string;
  updatedAt: string | null;
  updatedByEmail: string | null;
}

interface Props {
  maintenanceMode: SettingMeta;
  maintenanceMessage: SettingMeta;
  onSuccess: () => void;
}

export function MaintenanceModePanel({ maintenanceMode, maintenanceMessage, onSuccess }: Props) {
  const isOn = maintenanceMode.value === "true";
  const [message, setMessage] = useState(maintenanceMessage.value);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveSetting(key: string, value: string) {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Session expired — please sign in again.");
    await callAdminFunction(session.access_token, "admin-set-app-setting", {
      type: "setting",
      key,
      value,
    });
  }

  async function saveMessage() {
    setLoading(true);
    setError(null);
    try {
      await saveSetting("maintenance_message", message.trim());
      onSuccess();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  }

  async function toggleMaintenance() {
    setLoading(true);
    setError(null);
    try {
      // Save the current message first so it's up to date when toggling on
      if (!isOn) {
        await saveSetting("maintenance_message", message.trim());
      }
      await saveSetting("maintenance_mode", isOn ? "false" : "true");
      setConfirming(false);
      onSuccess();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Failed to toggle");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={`card border-2 ${isOn ? "border-danger bg-danger/5" : "border-border"}`}>
      {isOn && (
        <div className="-mx-1 -mt-1 mb-4 flex items-center gap-2 rounded-md bg-danger px-3 py-2 text-white">
          <span aria-hidden>⛔</span>
          <p className="text-sm font-bold uppercase tracking-wide">Maintenance mode is ON — SmallBird is down for users</p>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">Maintenance mode</h2>
          <p className="mt-0.5 text-xs text-muted">
            When enabled, users can&apos;t start sessions, get AI answers, or open the upgrade page — they see the
            message below instead. Sessions already running still end and get billed normally.
          </p>
        </div>
        <span
          className={`ml-4 shrink-0 rounded-full px-4 py-1.5 text-sm font-bold ${
            isOn ? "bg-danger text-white" : "bg-ok/10 text-ok"
          }`}
        >
          {isOn ? "● ON" : "OFF"}
        </span>
      </div>

      {maintenanceMode.updatedByEmail && (
        <p className="mt-2 text-xs text-muted">
          Last changed by {maintenanceMode.updatedByEmail}
          {maintenanceMode.updatedAt && <> on {new Date(maintenanceMode.updatedAt).toLocaleString()}</>}
        </p>
      )}

      <div className="mt-4 space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Message shown to users</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="input"
            rows={2}
            placeholder="SmallBird is currently under maintenance. Please check back shortly."
          />
          <button
            type="button"
            disabled={loading || message.trim() === maintenanceMessage.value}
            onClick={saveMessage}
            className="btn-secondary mt-2 text-xs"
          >
            {loading ? "Saving…" : "Save message"}
          </button>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        {!confirming ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => setConfirming(true)}
            className={`btn w-full text-white shadow-sm hover:opacity-90 ${isOn ? "bg-ok" : "bg-danger"}`}
          >
            {isOn ? "Turn off maintenance mode" : "Turn ON maintenance mode"}
          </button>
        ) : (
          <div className="rounded-lg border border-warn bg-warn/5 p-3">
            <p className="text-sm font-semibold text-warn">
              {isOn ? "Turn off maintenance mode?" : "Turn ON maintenance mode?"}
            </p>
            <p className="mt-1 text-xs text-muted">
              {isOn
                ? "Users will be able to start new sessions again immediately."
                : "New sessions, AI answers and the upgrade page will be blocked immediately for all users."}
            </p>
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={loading} onClick={toggleMaintenance} className="btn-primary flex-1">
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
