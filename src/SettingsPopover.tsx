import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { PersonalizationPanel } from "./PersonalizationPanel";
import { AttachedDocumentsPanel } from "./AttachedDocumentsPanel";

type SettingsSection = "SESSIONS" | "PERSONALIZATION" | "CONTEXT" | "PRIVACY" | "ABOUT";

const SECTIONS: { key: SettingsSection; label: string }[] = [
  { key: "SESSIONS", label: "Sessions" },
  { key: "PERSONALIZATION", label: "Personalization" },
  { key: "CONTEXT", label: "Context / Documents" },
  { key: "PRIVACY", label: "Privacy" },
  { key: "ABOUT", label: "About / Version" },
];

interface Props {
  onClose: () => void;
}

/// Settings popover reached from the header's gear icon. Every section
/// renders inline in settings-popover-content alongside the nav rail. Only
/// sections with real content are listed here — General/Audio/Notifications
/// were placeholder stubs and have been dropped, and Performance (hardware
/// detection + manual STT tuning) was removed since STT runs against
/// Deepgram's cloud rather than a locally-sized thread pool, so there was no
/// real tuning left for it to do. Sessions and Personalization
/// (answer tone/length/style) live here rather than as separate header
/// buttons, alongside the app's other settings. API key management lives in
/// the Account panel instead of here now that the app requires login rather
/// than a locally-stored key. Past interview transcripts are no longer
/// listed here — they live on the website dashboard (see the "Open
/// Dashboard" button on the post-interview screen in InterviewOverlay.tsx),
/// so Sessions just links out there instead of duplicating that list.
export function SettingsPopover({ onClose }: Props) {
  const [section, setSection] = useState<SettingsSection>("SESSIONS");
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  return (
    <div className="popover-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="popover" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="popover-header">
          <span className="setup-section-label">Settings</span>
          <button className="modal-close-btn" onClick={onClose} title="Close" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="popover-body settings-popover-body">
          <div className="workspace-nav settings-popover-nav">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                className={["workspace-nav-item", section === s.key ? "active" : ""].filter(Boolean).join(" ")}
                onClick={() => setSection(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="settings-popover-content">
            {section === "SESSIONS" && (
              <div className="settings-sessions-panel">
                <p className="setup-hint" style={{ margin: 0 }}>
                  Your past interviews — transcripts and details — are saved to your account and viewable from the
                  Smallbird dashboard on the web.
                </p>
                <button
                  className="overlay-text-button primary"
                  style={{ marginTop: 12 }}
                  onClick={() => invoke("open_dashboard").catch((e) => console.error("Failed to open dashboard:", e))}
                >
                  Open Dashboard
                </button>
              </div>
            )}
            {section === "PERSONALIZATION" && <PersonalizationPanel />}
            {section === "CONTEXT" && <AttachedDocumentsPanel />}
            {section === "PRIVACY" && (
              <p className="setup-hint">
                Smallbird extracts text from your uploaded resume/CV and job description locally on this device.
                Speech-to-text audio is sent, encrypted, directly to Deepgram (via a short-lived key issued per
                session) for transcription — nowhere else. Interview analysis and Notes AI features route
                through Smallbird's backend using your signed-in account, which is how usage against your plan
                is metered.
              </p>
            )}
            {section === "ABOUT" && (
              <>
                <p className="setup-hint" style={{ margin: 0 }}>
                  Smallbird — version {appVersion ?? "…"}
                </p>
                <p className="setup-hint" style={{ margin: "6px 0 0" }}>
                  SmallBird™ is a trademark of Smallbird. © {new Date().getFullYear()} Smallbird. All rights
                  reserved.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
