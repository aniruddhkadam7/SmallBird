-- Widens 0047 from just the resume and JD to everything a user gives the AI
-- as context in a session, in every mode: custom instructions, resume, JD,
-- additional context, meeting docs, assistant/custom-mode files, and the
-- text read from screenshots. The desktop app sends it with the transcript
-- upsert as a list of { id, docType, filename, text } (see
-- src-tauri/src/history.rs), so the admin console can see what each
-- session was run with. 0047's two columns were never filled by a released
-- app, so they're dropped rather than kept alongside.
alter table public.interview_transcripts
  drop column if exists resume_text,
  drop column if exists job_description_text,
  add column if not exists context_docs jsonb not null default '[]'::jsonb;

create or replace function public.admin_transcript_detail(p_transcript_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.jsonb_build_object from (
    select jsonb_build_object(
      'id', t.id, 'userId', t.user_id, 'email', u.email, 'role', t.role, 'company', t.company,
      'startedAtMs', t.started_at_ms, 'endedAtMs', t.ended_at_ms, 'turns', t.turns, 'createdAt', t.created_at,
      'contextDocs', t.context_docs
    )
    from public.interview_transcripts t join auth.users u on u.id = t.user_id where t.id = p_transcript_id
  ) f cross join _auth;
$$;

revoke all on function public.admin_transcript_detail(uuid) from public, anon, authenticated;
grant execute on function public.admin_transcript_detail(uuid) to authenticated, service_role;
