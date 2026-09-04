import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface HistoryTurn {
  question: string;
  answer: string;
  /// Absent for entries archived before this field existed.
  askedAtMs?: number | null;
}

interface InterviewHistoryEntry {
  id: string;
  started_at_ms: number;
  ended_at_ms: number;
  role: string | null;
  company: string | null;
  turns: HistoryTurn[];
}

function formatDate(ms: number) {
  const date = new Date(ms);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatDuration(startMs: number, endMs: number) {
  const totalSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function preview(entry: InterviewHistoryEntry): string {
  const first = entry.turns[0];
  if (!first) return "No questions were asked in this session.";
  return first.question;
}

function initialsFor(entry: InterviewHistoryEntry): string {
  const source = entry.company || entry.role;
  if (!source) return "?";
  const words = source.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/// Builds a plain-text transcript for the Download action — timestamps are
/// included only where available (older entries archived before per-turn
/// timestamps were tracked just omit them).
function transcriptText(entry: InterviewHistoryEntry): string {
  const title = [entry.role, entry.company].filter(Boolean).join(" · ") || "Interview";
  const lines = [
    title,
    `${formatDate(entry.started_at_ms)} at ${formatTime(entry.started_at_ms)} · ${formatDuration(entry.started_at_ms, entry.ended_at_ms)}`,
    "",
  ];
  entry.turns.forEach((turn) => {
    const time = turn.askedAtMs ? ` (${formatTime(turn.askedAtMs)})` : "";
    lines.push(`Interviewer${time}:`, turn.question, "", `Smallbird${time}:`, turn.answer, "");
  });
  return lines.join("\n");
}

function downloadTranscript(entry: InterviewHistoryEntry) {
  const blob = new Blob([transcriptText(entry)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeTitle = (entry.role || entry.company || "interview").replace(/[^\w-]+/g, "_");
  a.href = url;
  a.download = `${safeTitle}-${entry.id}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type DetailTab = "transcript" | "details";

interface Props {
  refreshKey: number;
}

export function InterviewHistory({ refreshKey }: Props) {
  const [entries, setEntries] = useState<InterviewHistoryEntry[]>([]);
  const [selected, setSelected] = useState<InterviewHistoryEntry | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("transcript");
  const [confirmingClear, setConfirmingClear] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await invoke<InterviewHistoryEntry[]>("list_interview_history");
      setEntries(list);
    } catch {
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    refresh();
    setSelected(null);
    setDetailTab("transcript");
    setConfirmingClear(false);
  }, [refresh, refreshKey]);

  const removeEntry = useCallback(
    async (id: string) => {
      try {
        await invoke("delete_interview_history_entry", { id });
        setSelected((cur) => (cur?.id === id ? null : cur));
        await refresh();
      } catch {
        // Best-effort — the entry stays in the list if deletion fails.
      }
    },
    [refresh],
  );

  if (selected) {
    return (
      <div className="transcript-view">
        <div className="transcript-view-head">
          <div className="transcript-view-identity">
            <span className="transcript-view-avatar">{initialsFor(selected)}</span>
            <div className="transcript-view-titles">
              <span className="transcript-view-title">{selected.role || "Interview"}</span>
              {selected.company && <span className="transcript-view-subtitle">{selected.company}</span>}
            </div>
          </div>
          <div className="transcript-view-actions">
            <button
              type="button"
              className="link-button danger"
              onClick={() => setConfirmingClear(true)}
              disabled={selected.turns.length === 0}
            >
              Clear Transcript
            </button>
            <button type="button" className="link-button neutral" onClick={() => downloadTranscript(selected)}>
              Download
            </button>
            <button
              className="modal-close-btn"
              onClick={() => setSelected(null)}
              title="Close"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {confirmingClear && (
          <div className="transcript-clear-confirm">
            <span>Clear this transcript? This can't be undone.</span>
            <div className="transcript-clear-confirm-actions">
              <button className="link-button neutral" onClick={() => setConfirmingClear(false)}>
                Cancel
              </button>
              <button
                className="link-button danger"
                onClick={() => {
                  setConfirmingClear(false);
                  removeEntry(selected.id);
                }}
              >
                Clear
              </button>
            </div>
          </div>
        )}

        <div className="transcript-view-tabs">
          <button
            type="button"
            className={`transcript-tab${detailTab === "transcript" ? " active" : ""}`}
            onClick={() => setDetailTab("transcript")}
          >
            Transcript
          </button>
          <button
            type="button"
            className={`transcript-tab${detailTab === "details" ? " active" : ""}`}
            onClick={() => setDetailTab("details")}
          >
            Call Details
          </button>
        </div>

        {detailTab === "transcript" ? (
          <div className="transcript-body" role="log" aria-readonly="true">
            {selected.turns.length === 0 ? (
              <p className="history-empty">No questions were asked in this session.</p>
            ) : (
              selected.turns.map((turn, i) => {
                const time = turn.askedAtMs ? formatTime(turn.askedAtMs) : null;
                return (
                  <div key={i} className="transcript-turn">
                    <div className="transcript-bubble interviewer">
                      <p className="transcript-bubble-text">{turn.question}</p>
                    </div>
                    <div className="transcript-bubble-meta">
                      Interviewer{time ? ` · ${time}` : ""}
                    </div>
                    <div className="transcript-bubble smallbird">
                      <p className="transcript-bubble-text">{turn.answer}</p>
                    </div>
                    <div className="transcript-bubble-meta">
                      Smallbird{time ? ` · ${time}` : ""}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="transcript-details">
            <div className="transcript-details-row">
              <span className="transcript-details-label">Role</span>
              <span className="transcript-details-value">{selected.role || "—"}</span>
            </div>
            <div className="transcript-details-row">
              <span className="transcript-details-label">Company</span>
              <span className="transcript-details-value">{selected.company || "—"}</span>
            </div>
            <div className="transcript-details-row">
              <span className="transcript-details-label">Date</span>
              <span className="transcript-details-value">{formatDate(selected.started_at_ms)}</span>
            </div>
            <div className="transcript-details-row">
              <span className="transcript-details-label">Started</span>
              <span className="transcript-details-value">{formatTime(selected.started_at_ms)}</span>
            </div>
            <div className="transcript-details-row">
              <span className="transcript-details-label">Ended</span>
              <span className="transcript-details-value">{formatTime(selected.ended_at_ms)}</span>
            </div>
            <div className="transcript-details-row">
              <span className="transcript-details-label">Duration</span>
              <span className="transcript-details-value">
                {formatDuration(selected.started_at_ms, selected.ended_at_ms)}
              </span>
            </div>
            <div className="transcript-details-row">
              <span className="transcript-details-label">Questions</span>
              <span className="transcript-details-value">{selected.turns.length}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="history-view">
      <section className="setup-hero">
        <h1 className="setup-title">History</h1>
        <p className="setup-subtitle">Review your past interviews</p>
      </section>

      {entries.length === 0 ? (
        <p className="history-empty">Past interviews will appear here once you complete one.</p>
      ) : (
        <div className="history-entries">
          {entries.map((entry) => (
            <button
              className="history-entry-card"
              key={entry.id}
              onClick={() => {
                setSelected(entry);
                setDetailTab("transcript");
                setConfirmingClear(false);
              }}
            >
              <div className="history-entry-top">
                <span className="history-entry-title">
                  {entry.role || entry.company
                    ? [entry.role, entry.company].filter(Boolean).join(" · ")
                    : "Interview"}
                </span>
                <span className="history-entry-duration">
                  {formatDuration(entry.started_at_ms, entry.ended_at_ms)}
                </span>
              </div>
              <span className="history-entry-when">
                {formatDate(entry.started_at_ms)} at {formatTime(entry.started_at_ms)}
              </span>
              <p className="history-entry-preview">{preview(entry)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
