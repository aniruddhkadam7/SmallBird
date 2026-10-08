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
    <section className="card border-2 border-warn/30 bg-warn/5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">Maintenance mode</h2>
          <p className="mt-0.5 text-xs text-muted">
            When enabled, all new session starts and AI calls are blocked immediately. Active sessions
            are not affected — they continue until they end naturally.
          </p>
        </div>
        <span
          className={`ml-4 shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
            isOn ? "bg-danger/10 text-danger" : "bg-ok/10 text-ok"
          }`}
        >
          {isOn ? "ON" : "OFF"}
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
            className={`w-full ${isOn ? "btn-primary bg-ok text-white hover:opacity-90" : "btn-primary bg-danger text-white hover:opacity-90"}`}
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
                : "All new session starts and AI calls will be blocked immediately for all users."}
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
