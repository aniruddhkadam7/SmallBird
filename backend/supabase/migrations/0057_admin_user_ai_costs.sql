-- AI spend per user and per interview session, for the admin console's
-- Users list and user detail page (admin-user-ai-costs).
--
-- Rows are grouped by UTC day because admin-user-ai-costs scales each day's
-- list-price estimates to OpenAI's real bill for that day, and that factor
-- needs the estimate total of EVERY user's calls on the day (dayTotals), not
-- just the requested users'. session_id is null for calls outside an
-- interview (e.g. Resume Builder); those count toward the user's total only.

create or replace function public.admin_user_ai_costs(p_user_ids uuid[])
returns jsonb
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id()),
  rows as (
    select c.user_id, c.session_id, (c.created_at at time zone 'utc')::date as day,
           count(*) as calls, coalesce(sum(c.estimated_cost_usd), 0) as est
    from public.usage_costs c
    cross join _auth
    where c.user_id = any(p_user_ids)
    group by c.user_id, c.session_id, (c.created_at at time zone 'utc')::date
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', r.user_id, 'sessionId', r.session_id, 'day', r.day, 'calls', r.calls, 'estimatedCostUsd', r.est
      )) from rows r
    ), '[]'::jsonb),
    'dayTotals', coalesce((
      select jsonb_object_agg(t.day, t.est) from (
        select (c.created_at at time zone 'utc')::date as day, coalesce(sum(c.estimated_cost_usd), 0) as est
        from public.usage_costs c
        where (c.created_at at time zone 'utc')::date in (select distinct day from rows)
        group by 1
      ) t
    ), '{}'::jsonb)
  )
  from _auth;
$$;

revoke all on function public.admin_user_ai_costs(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_user_ai_costs(uuid[]) to authenticated, service_role;
