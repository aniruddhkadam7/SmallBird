-- Stores each completed Interview Mode session's Q&A turns server-side so the
-- website can show a user their past interviews. Previously this lived only
-- in a local JSON file on the device that ran the session (see
-- src-tauri/src/history.rs) -- nothing about actual transcript content ever
-- reached the backend before this. Only sessions completed after this ships
-- get synced; nothing is backfilled from local files that already exist.
--
-- Plain text/JSONB storage here is deliberately simple and cheap: a typical
-- interview is tens of KB, and the total volume any one user can ever
-- generate is already bounded by the same entitlement-minutes system that
-- caps their AI/STT usage, so this table's storage cost scales with (and
-- stays far below) costs already being paid per session.
create table if not exists public.interview_transcripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  started_at_ms bigint not null,
  ended_at_ms bigint not null,
  role text,
  company text,
  turns jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists interview_transcripts_user_id_started_at_idx
  on public.interview_transcripts (user_id, started_at_ms desc);

alter table public.interview_transcripts enable row level security;

-- Every policy scopes strictly to the caller's own rows -- the desktop app
-- inserts with the signed-in user's own access token (never the service
-- role key) via PostgREST directly, same pattern as the entitlements read in
-- auth::client::get_entitlement. user_id defaults to auth.uid() so the
-- client never sends it explicitly, which is what makes the with-check
-- below actually meaningful (nothing client-suppliable could ever satisfy
-- it with someone else's id).
create policy "interview_transcripts_select_own"
  on public.interview_transcripts for select
  using (auth.uid() = user_id);

create policy "interview_transcripts_insert_own"
  on public.interview_transcripts for insert
  with check (auth.uid() = user_id);

create policy "interview_transcripts_delete_own"
  on public.interview_transcripts for delete
  using (auth.uid() = user_id);
