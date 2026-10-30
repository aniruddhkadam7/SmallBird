"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useAdminQuery, AdminApiError } from "@/lib/useAdminQuery";
import { Unauthorized } from "@/components/Unauthorized";
import { PageLoading } from "@/components/PageLoading";
import { formatDuration } from "@/lib/format";
import { TranscriptDocs, type ContextDoc } from "@/components/TranscriptDocs";
import { Markdown } from "@/components/Markdown";

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

export default function TranscriptDetailPage() {
  const params = useParams<{ id: string }>();
  const { data: transcript, error } = useAdminQuery<TranscriptDetail>("admin-transcript-detail", {
    transcriptId: params.id,
  });

  if (error instanceof AdminApiError && error.status === 403) return <Unauthorized />;
  if (error instanceof AdminApiError && error.status === 404) return <p className="text-sm text-muted">Transcript not found.</p>;
  if (!transcript) return <PageLoading error={error} />;

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <Link href="/sessions" className="text-sm text-accent hover:underline">
          &larr; Back to sessions
        </Link>
        <h1 className="mt-2 text-lg font-semibold text-ink">
          {transcript.role ?? "Interview"} {transcript.company && `@ ${transcript.company}`}
        </h1>
        <p className="text-sm text-muted">
          <Link href={`/users/${transcript.userId}`} className="text-accent hover:underline">
            {transcript.email}
          </Link>{" "}
          &middot; {new Date(transcript.startedAtMs).toLocaleString()} &middot;{" "}
          {formatDuration((transcript.endedAtMs - transcript.startedAtMs) / 1000)} &middot; {transcript.turns.length} turns
        </p>
      </div>

      <TranscriptDocs docs={transcript.contextDocs} />

      <div className="space-y-4">
        {transcript.turns.map((turn, i) => (
          <div key={i} className="card">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Question {i + 1}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{turn.question}</p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Answer</p>
            <Markdown className="mt-1 text-sm text-ink">{turn.answer}</Markdown>
            {turn.askedAtMs && <p className="mt-2 text-xs text-muted">{new Date(turn.askedAtMs).toLocaleTimeString()}</p>}
          </div>
        ))}
        {transcript.turns.length === 0 && <p className="text-sm text-muted">No turns recorded.</p>}
      </div>
    </div>
  );
}
