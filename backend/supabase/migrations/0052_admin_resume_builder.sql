-- The admin console's Resume Builder page: how many people use the website's
-- resume builder, which AI actions they use, and per user what they built and
-- what they gave the AI (the CV they imported, the JDs they tailored to).
--
-- resume_ai_requests keeps the user's inputs to resume-ai, one row per AI
-- action that finished. usage_costs (request_kind 'resume_<action>') already
-- counts them and their cost, but holds no text; this is the text. Only the
-- resume-ai Edge Function (service role) writes it and only admins read it,
-- through the functions below -- no policies, so users can't see it at all.
create table if not exists public.resume_ai_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  -- "import": the old resume's text. Other actions leave it null.
  uploaded_text text,
  job_description text,
  instructions text,
  created_at timestamptz not null default now()
);

create index if not exists resume_ai_requests_user_id_created_at_idx
  on public.resume_ai_requests (user_id, created_at desc);

alter table public.resume_ai_requests enable row level security;
revoke all on public.resume_ai_requests from public, anon, authenticated;

-- The page's overview. AI counts come from usage_costs so actions from before
-- this migration are counted too. Days are in India time.
create or replace function public.admin_resume_builder_stats()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id()),
  ai as (
    select user_id, substr(request_kind, 8) as action, created_at
    from public.usage_costs where request_kind like 'resume\_%'
  ),
  per_user as (
    select user_id,
           count(*) filter (where src = 'resume') as resumes,
           count(*) filter (where src = 'ai') as ai_actions,
           max(at) as last_active,
           min(at) as first_used
    from (
      select user_id, 'resume' as src, updated_at as at from public.resumes
      union all
      select user_id, 'ai', created_at from ai
    ) x
    group by user_id
  ),
  days as (
    select generate_series(
      (now() at time zone 'Asia/Kolkata')::date - 29,
      (now() at time zone 'Asia/Kolkata')::date,
      interval '1 day'
    )::date as day
  )
  select jsonb_build_object(
    'totalUsers', (select count(*) from auth.users),
    'builderUsers', (select count(*) from per_user),
    'resumes', (select count(*) from public.resumes),
    'usersWithResume', (select count(distinct user_id) from public.resumes),
    'aiActions', (select count(*) from ai),
    'aiUsers', (select count(distinct user_id) from ai),
    'activeUsers7d', (select count(*) from per_user where last_active >= now() - interval '7 days'),
    'newUsers7d', (select count(*) from per_user where first_used >= now() - interval '7 days'),
    'aiCostUsd', (select coalesce(sum(estimated_cost_usd), 0) from public.usage_costs where request_kind like 'resume\_%'),
    'byAction', (
      select coalesce(jsonb_agg(jsonb_build_object('action', action, 'count', n, 'users', u) order by n desc), '[]'::jsonb)
      from (select action, count(*) n, count(distinct user_id) u from ai group by action) a
    ),
    'daily', (
      select jsonb_agg(jsonb_build_object(
        'day', d.day,
        'resumesCreated', (select count(*) from public.resumes r where (r.created_at at time zone 'Asia/Kolkata')::date = d.day),
        'aiActions', (select count(*) from ai where (ai.created_at at time zone 'Asia/Kolkata')::date = d.day),
        'users', (select count(distinct user_id) from (
                    select user_id from public.resumes r where (r.updated_at at time zone 'Asia/Kolkata')::date = d.day
                    union select user_id from ai where (ai.created_at at time zone 'Asia/Kolkata')::date = d.day) z)
      ) order by d.day)
      from days d
    ),
    'users', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'userId', p.user_id, 'email', u.email, 'planId', e.plan_id,
        'resumes', p.resumes, 'aiActions', p.ai_actions,
        'jdCount', (select count(*) from public.resume_ai_requests q where q.user_id = p.user_id and q.job_description is not null),
        'firstUsed', p.first_used, 'lastActive', p.last_active
      ) order by p.last_active desc), '[]'::jsonb)
      from (select * from per_user order by last_active desc limit 300) p
      join auth.users u on u.id = p.user_id
      left join public.entitlements e on e.user_id = p.user_id
    )
  )
  from _auth;
$$;

-- One user's resumes (full JSON, for the console to render) and what they
-- gave the AI, newest first.
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
        'jobDescription', q.job_description, 'instructions', q.instructions, 'createdAt', q.created_at
      ) order by q.created_at desc), '[]'::jsonb)
      from (select * from public.resume_ai_requests where user_id = p_user_id order by created_at desc limit 100) q
    )
  )
  from _auth;
$$;

revoke all on function public.admin_resume_builder_stats() from public, anon, authenticated;
grant execute on function public.admin_resume_builder_stats() to authenticated, service_role;
revoke all on function public.admin_user_resume_builder(uuid) from public, anon, authenticated;
grant execute on function public.admin_user_resume_builder(uuid) to authenticated, service_role;
