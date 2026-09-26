import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "./ui";
import type { SessionMode } from "./sessionMode";

/// One saved session, as `history.rs`'s list_interview_history returns it.
export interface HistoryTurn {
  question: string;
  answer: string;
  askedAtMs?: number | null;
  kind?: string | null;
}

export interface HistoryEntry {
  id: string;
  started_at_ms: number;
  ended_at_ms: number;
  role?: string | null;
  company?: string | null;
  turns: HistoryTurn[];
}

/// A session's mode and details, recovered from how it was labelled when
/// saved (see InterviewOverlay's transcriptLabels): "Assistant", "Meeting" /
/// "Meeting: <topic>", or an interview's role/company.
export function sessionDetails(entry: HistoryEntry): {
  mode: SessionMode;
  role: string;
  company: string;
  meetingTopic: string;
} {
  const role = entry.role?.trim() ?? "";
  if (role === "Assistant") return { mode: "assistant", role: "", company: "", meetingTopic: "" };
  if (role === "Meeting" || role.startsWith("Meeting:")) {
    return { mode: "meeting", role: "", company: "", meetingTopic: role.replace(/^Meeting:?\s*/, "") };
  }
  return { mode: "interview", role, company: entry.company?.trim() ?? "", meetingTopic: "" };
}

const MODE_LABEL: Record<SessionMode, string> = { interview: "Interview", meeting: "Meeting", assistant: "Assistant" };

function sessionTitle(entry: HistoryEntry): string {
  const first = entry.turns.find((t) => t.question.trim())?.question.trim();
  if (first) return first.length > 80 ? `${first.slice(0, 80)}…` : first;
  const { mode, role, meetingTopic } = sessionDetails(entry);
  return meetingTopic || role || `${MODE_LABEL[mode]} session`;
}

function when(ms: number): string {
  const date = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString([], { day: "numeric", month: "short", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" })}, ${time}`;
}

interface Props {
  /// Continue this session: a new live session in its mode, with its
  /// conversation loaded (see App.tsx's handleContinueSession).
  onContinue: (entry: HistoryEntry) => void;
  /// A session is running — continuing another has to wait until it ends.
  sessionRunning: boolean;
}

/// Settings → Sessions: every saved session, most recently active first, like
/// a chat app's history. Open one to read it; Continue picks it up again.
export function SessionsPanel({ onContinue, sessionRunning }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    invoke<HistoryEntry[]>("list_interview_history")
      .then((list) => setEntries([...list].sort((a, b) => b.ended_at_ms - a.ended_at_ms)))
      .catch(() => setEntries([]));
  }, []);

  const shown = useMemo(() => {
    if (!entries) return [];
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        (e.role ?? "").toLowerCase().includes(q) ||
        (e.company ?? "").toLowerCase().includes(q) ||
        e.turns.some((t) => t.question.toLowerCase().includes(q) || t.answer.toLowerCase().includes(q)),
    );
  }, [entries, search]);

  return (
    <div className="sessions-panel">
      <div className="sessions-panel-top">
        <input
          className="setup-input sessions-search"
          type="search"
          placeholder="Search your sessions"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {/* Same look as the header's Context button. */}
        <button
          type="button"
          className="compact-header-btn sessions-dashboard-btn"
          onClick={() => invoke("open_dashboard").catch((e) => console.error("Failed to open dashboard:", e))}
        >
          Open Dashboard
        </button>
      </div>

      {entries === null ? (
        <p className="setup-hint">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="setup-hint">{entries.length === 0 ? "No sessions yet — they'll show up here once you've asked something." : "No sessions match that."}</p>
      ) : (
        <ul className="sessions-list">
          {shown.map((entry) => {
            const { mode } = sessionDetails(entry);
            const open = openId === entry.id;
            return (
              <li key={entry.id} className={`sessions-item${open ? " open" : ""}`}>
                <button type="button" className="sessions-item-head" onClick={() => setOpenId(open ? null : entry.id)} aria-expanded={open}>
                  <span className="sessions-item-title">{sessionTitle(entry)}</span>
                  <span className="sessions-item-meta">
                    <span className={`sessions-mode sessions-mode-${mode}`}>{MODE_LABEL[mode]}</span>
                    <span>{when(entry.ended_at_ms)}</span>
                    <span>
                      {entry.turns.length} {entry.turns.length === 1 ? "question" : "questions"}
                    </span>
                  </span>
                </button>
                {open && (
                  <div className="sessions-item-body">
                    <div className="sessions-conversation">
                      {entry.turns.map((t, i) => (
                        <div key={i} className="sessions-turn">
                          <div className="sessions-turn-q">
                            <span className="sessions-turn-label">Q</span>
                            <p>{t.question}</p>
                          </div>
                          <div className="sessions-turn-a">
                            <span className="sessions-turn-label">A</span>
                            <div className="sessions-answer">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{t.answer}</ReactMarkdown>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="sessions-item-actions">
                      <Button
                        variant="primary"
                        onClick={() => onContinue(entry)}
                        disabled={sessionRunning}
                        title={sessionRunning ? "End the current session first" : undefined}
                      >
                        Continue this session
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
