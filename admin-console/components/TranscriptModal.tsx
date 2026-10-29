"use client";

import { useEffect } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { formatDuration } from "@/lib/format";
import { TranscriptDocs, type ContextDoc } from "@/components/TranscriptDocs";

interface Turn {
  question: string;
  answer: string;
  askedAtMs?: number;
}

interface TranscriptDetail {
  id: string;
  userId: string;
  email: string;
  role: string | null;
  company: string | null;
  startedAtMs: number;
  endedAtMs: number;
  turns: Turn[];
  createdAt: string;
  contextDocs?: ContextDoc[];
}

export function TranscriptModal({ transcriptId, onClose }: { transcriptId: string | null; onClose: () => void }) {
  const { data: transcript, error } = useAdminQuery<TranscriptDetail>(
    "admin-transcript-detail",
    { transcriptId: transcriptId ?? "" },
    { isPaused: () => !transcriptId },
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (transcriptId) document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [transcriptId, onClose]);

  if (!transcriptId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-surface shadow-card sm:max-h-[85vh] sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-border bg-surface p-4">
          <div>
            {transcript ? (
              <>
                <h2 className="text-base font-semibold text-ink">
                  {transcript.role ?? "Interview"} {transcript.company && `@ ${transcript.company}`}
                </h2>
                <p className="mt-0.5 text-xs text-muted">
                  <Link href={`/users/${transcript.userId}`} className="text-accent hover:underline">
                    {transcript.email}
                  </Link>{" "}
                  &middot; {new Date(transcript.startedAtMs).toLocaleString()} &middot;{" "}
                  {formatDuration((transcript.endedAtMs - transcript.startedAtMs) / 1000)} &middot;{" "}
                  {transcript.turns.length} turns
                </p>
              </>
            ) : (
              <h2 className="text-base font-semibold text-ink">Transcript</h2>
            )}
          </div>
          <button onClick={onClose} className="flex-shrink-0 rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {error instanceof AdminApiError && <p className="text-sm text-danger">{error.message}</p>}
          {!transcript && !error && <p className="text-sm text-muted">Loading...</p>}
          {transcript && <TranscriptDocs docs={transcript.contextDocs} />}
          {transcript?.turns.map((turn, i) => (
            <div key={i} className="card">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Question {i + 1}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{turn.question}</p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Answer</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{turn.answer}</p>
            </div>
          ))}
          {transcript && transcript.turns.length === 0 && <p className="text-sm text-muted">No turns recorded.</p>}
        </div>
      </div>
    </div>
  );
}
