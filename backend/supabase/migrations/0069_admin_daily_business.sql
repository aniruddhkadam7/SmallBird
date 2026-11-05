-- Daily business numbers for the admin console's home-page graphs: money
-- received, interviews, minutes used and people who used the app, one row per
-- day (India time) with zeros for quiet days. Admin-only, like
-- admin_web_analytics (0063): current_admin_user_id() raises for anyone else.
-- Staff accounts (admin_users) are left out, as on the Analytics page.
create or replace function public.admin_daily_business(p_days int default 30)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id() as admin_id),
  days as (
    select generate_series(
      ((now() at time zone 'Asia/Kolkata')::date - (greatest(1, least(p_days, 365)) - 1)),
      (now() at time zone 'Asia/Kolkata')::date,
      interval '1 day'
    )::date as day
  ),
  sessions as (
    select s.user_id, (s.started_at at time zone 'Asia/Kolkata')::date as day, s.minutes_consumed
    from public.interview_sessions s
    where not exists (select 1 from public.admin_users a where a.user_id = s.user_id)
  ),
  payments as (
    select (p.created_at at time zone 'Asia/Kolkata')::date as day, p.amount_paise
    from public.purchases p
    where not exists (select 1 from public.admin_users a where a.user_id = p.user_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'day', d.day,
    'revenuePaise', (select coalesce(sum(amount_paise), 0) from payments x where x.day = d.day),
    'payments', (select count(*) from payments x where x.day = d.day),
    'interviews', (select count(*) from sessions x where x.day = d.day),
    'minutes', (select coalesce(round(sum(minutes_consumed)::numeric, 1), 0) from sessions x where x.day = d.day),
    'activeUsers', (select count(distinct user_id) from sessions x where x.day = d.day)
  ) order by d.day), '[]'::jsonb)
  from days d, _auth;
$$;

revoke all on function public.admin_daily_business(int) from public, anon, authenticated;
grant execute on function public.admin_daily_business(int) to authenticated, service_role;
