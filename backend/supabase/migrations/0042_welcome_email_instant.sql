-- Send the welcome email right after sign-up. The 15-second wait is only so
-- a user who registered inside the desktop app (verify-otp records that a
-- second or two after creating the account) isn't told to download an app
-- they already have. Checked every 20 seconds, so it arrives ~15-35s after
-- registering.

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
    and u.created_at <= now() - interval '15 seconds'
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

select cron.alter_job((select jobid from cron.job where jobname = 'welcome-email'), schedule := '20 seconds');
