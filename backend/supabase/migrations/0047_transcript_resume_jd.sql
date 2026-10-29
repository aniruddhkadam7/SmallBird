-- Stores the resume and job description an Interview Mode session was run
-- with, next to its transcript, so the admin console can see them. The
-- desktop app sends both with the transcript upsert (see
-- src-tauri/src/history.rs); other modes leave them null. Plain extracted
-- text, the same text the AI was given -- not the original file.
alter table public.interview_transcripts
  add column if not exists resume_text text,
  add column if not exists job_description_text text;

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
      'resumeText', t.resume_text, 'jobDescriptionText', t.job_description_text
    )
    from public.interview_transcripts t join auth.users u on u.id = t.user_id where t.id = p_transcript_id
  ) f cross join _auth;
$$;

revoke all on function public.admin_transcript_detail(uuid) from public, anon, authenticated;
grant execute on function public.admin_transcript_detail(uuid) to authenticated, service_role;
