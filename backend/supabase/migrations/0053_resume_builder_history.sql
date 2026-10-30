-- More for the admin console's Resume Builder page (0052): what the AI gave
-- back for each action, how each resume changed while the user built it, and
-- the CVs / JDs the same user uploaded in the desktop app.

-- What the action worked on besides the JD (rewrite: the line; improve: the
-- entry as JSON; with the place it sits) and the AI's reply as it was sent
-- back (tailor/edit/import: the resume and its notes; rewrite: text; improve:
-- items). Written by resume-ai only.
alter table public.resume_ai_requests
  add column if not exists input_text text,
  add column if not exists result jsonb;

-- Snapshots of a resume as it's built. The builder autosaves on every edit,
-- so a save within 10 minutes of the latest snapshot overwrites it instead of
-- adding one: one snapshot per stretch of work. No foreign key to resumes, so
-- the history stays when the user deletes the resume. Admin-only, like
-- resume_ai_requests.
create table if not exists public.resume_versions (
  id uuid primary key default gen_random_uuid(),
  resume_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  saved_at timestamptz not null default now()
);

create index if not exists resume_versions_user_id_saved_at_idx
  on public.resume_versions (user_id, saved_at desc);
create index if not exists resume_versions_resume_id_created_at_idx
  on public.resume_versions (resume_id, created_at desc);

alter table public.resume_versions enable row level security;
revoke all on public.resume_versions from public, anon, authenticated;

create or replace function public.resumes_record_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.resume_versions
   where resume_id = new.id and created_at > now() - interval '10 minutes'
   order by created_at desc limit 1;
  if v_id is not null then
    update public.resume_versions set title = new.title, data = new.data, saved_at = now() where id = v_id;
  else
    insert into public.resume_versions (resume_id, user_id, title, data) values (new.id, new.user_id, new.title, new.data);
  end if;
  return null;
end;
$$;

revoke all on function public.resumes_record_version() from public, anon, authenticated;

drop trigger if exists resumes_record_version on public.resumes;
create trigger resumes_record_version
  after insert or update of title, data on public.resumes
  for each row execute function public.resumes_record_version();

-- Resumes saved before this migration start their history with what they are now.
insert into public.resume_versions (resume_id, user_id, title, data, created_at, saved_at)
select r.id, r.user_id, r.title, r.data, r.updated_at, r.updated_at
from public.resumes r
where not exists (select 1 from public.resume_versions v where v.resume_id = r.id);

-- 0051 adds this too; added here as well so the function below works
-- whichever runs first.
alter table public.interview_transcripts
  add column if not exists context_docs jsonb not null default '[]'::jsonb;

create or replace function public.admin_user_resume_builder(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select jsonb_build_object(
    'resumes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'title', r.title, 'data', r.data, 'createdAt', r.created_at, 'updatedAt', r.updated_at
      ) order by r.updated_at desc), '[]'::jsonb)
      from public.resumes r where r.user_id = p_user_id
    ),
    'requests', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id, 'action', q.action, 'uploadedText', q.uploaded_text,
        'jobDescription', q.job_description, 'instructions', q.instructions,
        'inputText', q.input_text, 'result', q.result, 'createdAt', q.created_at
      ) order by q.created_at desc), '[]'::jsonb)
      from (select * from public.resume_ai_requests where user_id = p_user_id order by created_at desc limit 100) q
    ),
    'versions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'resumeId', v.resume_id, 'title', v.title, 'data', v.data,
        'createdAt', v.created_at, 'savedAt', v.saved_at,
        'deleted', not exists (select 1 from public.resumes r where r.id = v.resume_id)
      ) order by v.saved_at desc), '[]'::jsonb)
      from (select * from public.resume_versions where user_id = p_user_id order by saved_at desc limit 100) v
    ),
    -- The resume / JD sections of the user's desktop app sessions.
    'desktopDocs', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'transcriptId', t.id, 'sessionAt', t.created_at, 'role', t.role, 'company', t.company,
        'docType', d->>'docType', 'filename', d->>'filename', 'text', d->>'text'
      ) order by t.created_at desc), '[]'::jsonb)
      from public.interview_transcripts t
      cross join lateral jsonb_array_elements(t.context_docs) d
      where t.user_id = p_user_id and d->>'docType' in ('RESUME', 'JOB_DESCRIPTION')
    )
  )
  from _auth;
$$;

revoke all on function public.admin_user_resume_builder(uuid) from public, anon, authenticated;
grant execute on function public.admin_user_resume_builder(uuid) to authenticated, service_role;
