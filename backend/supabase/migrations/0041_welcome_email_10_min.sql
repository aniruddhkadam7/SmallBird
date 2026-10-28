-- Send the welcome email 10 minutes after sign-up instead of an hour, and
-- check every minute instead of hourly so it arrives close to that mark.

create or replace function public.welcome_email_candidates(p_limit int default 50)
returns table (user_id uuid, email text, name text)
language sql
security definer
set search_path = public
as $$
  select u.id, u.email::text, coalesce(pr.display_name, u.raw_user_meta_data->>'full_name')
  from auth.users u
  join public.entitlements e on e.user_id = u.id
  left join public.profiles pr on pr.id = u.id
  where u.email is not null
    and u.created_at <= now() - interval '10 minutes'
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not coalesce(pr.is_banned, false)
    and not exists (select 1 from public.interview_sessions s where s.user_id = u.id)
    and not exists (select 1 from public.user_devices d where d.user_id = u.id and d.client_kind = 'desktop')
    and not exists (select 1 from public.welcome_emails w where w.user_id = u.id)
  order by u.created_at
  limit p_limit;
$$;

revoke all on function public.welcome_email_candidates(int) from public, anon, authenticated;
grant execute on function public.welcome_email_candidates(int) to service_role;

select cron.alter_job((select jobid from cron.job where jobname = 'welcome-email'), schedule := '* * * * *');
