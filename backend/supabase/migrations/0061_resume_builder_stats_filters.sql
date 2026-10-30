-- The Resume Builder page's charts filter its People list: tapping a day shows
-- who used the builder that day, tapping an AI feature who used it. Adds each
-- person's features (with counts) and active days to admin_resume_builder_stats.
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
        -- For the page's filters: which AI features they used (with counts) and
        -- the India-time days they used the builder on.
        'actions', (select coalesce(jsonb_object_agg(action, n), '{}'::jsonb) from (select action, count(*) n from ai where ai.user_id = p.user_id group by action) a),
        'days', (select coalesce(jsonb_agg(distinct d), '[]'::jsonb) from (
                   select (r.updated_at at time zone 'Asia/Kolkata')::date d from public.resumes r where r.user_id = p.user_id
                   union select (ai.created_at at time zone 'Asia/Kolkata')::date from ai where ai.user_id = p.user_id) z),
        'firstUsed', p.first_used, 'lastActive', p.last_active
      ) order by p.last_active desc), '[]'::jsonb)
      from (select * from per_user order by last_active desc limit 300) p
      join auth.users u on u.id = p.user_id
      left join public.entitlements e on e.user_id = p.user_id
    )
  )
  from _auth;
$$;

revoke all on function public.admin_resume_builder_stats() from public, anon, authenticated;
grant execute on function public.admin_resume_builder_stats() to authenticated, service_role;
