-- The original CV file (PDF / DOCX) a user imports into the website's resume
-- builder, so the admin console can open it as it was. The website uploads it
-- to resume-uploads/<user id>/<random>-<file name> before calling resume-ai's
-- "import", and resume-ai stores the path with that request. Needs 0052/0053.
--
-- Private bucket: a user can only add files to their own folder and can't
-- read, change or list them afterwards; admins read them through short-lived
-- signed URLs the console creates.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resume-uploads', 'resume-uploads', false, 10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
on conflict (id) do nothing;

create policy "resume_uploads_insert_own_folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'resume-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "resume_uploads_admin_read"
  on storage.objects for select to authenticated
  using (bucket_id = 'resume-uploads' and exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

alter table public.resume_ai_requests
  add column if not exists uploaded_file_path text,
  add column if not exists uploaded_file_name text;

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
        'uploadedFilePath', q.uploaded_file_path, 'uploadedFileName', q.uploaded_file_name,
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
