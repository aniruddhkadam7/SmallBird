"use client";

// One transcript's full content. Read straight from Postgres with the
// admin_transcript_detail() RPC instead of the admin-transcript-detail Edge
// Function: the RPC does its own admin check (current_admin_user_id() raises
// 42501), and skipping the function skips its cold start, which was most of
// the time a transcript took to open.
import useSWR, { mutate as globalMutate } from "swr";
import { createClient } from "@/lib/supabase/client";
import { AdminApiError } from "@/lib/adminApi";
import type { ContextDoc } from "@/components/TranscriptDocs";

export interface Turn {
  question: string;
  answer: string;
  askedAtMs?: number;
}

export interface TranscriptDetail {
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

async function fetchTranscript(transcriptId: string): Promise<TranscriptDetail> {
  const { data, error } = await createClient().rpc("admin_transcript_detail", { p_transcript_id: transcriptId });
  if (error) throw new AdminApiError(error.code === "42501" ? 403 : 500, error.message);
  if (!data) throw new AdminApiError(404, "Transcript not found");
  return data as TranscriptDetail;
}

const key = (transcriptId: string) => ["admin_transcript_detail", transcriptId];

export function useTranscript(transcriptId: string | null) {
  return useSWR<TranscriptDetail>(transcriptId ? key(transcriptId) : null, () => fetchTranscript(transcriptId!), {
    dedupingInterval: 4000,
  });
}

// Warms the cache on row hover so the modal opened on click is already filled.
export function prefetchTranscript(transcriptId: string) {
  globalMutate(key(transcriptId), fetchTranscript(transcriptId), { revalidate: false });
}
