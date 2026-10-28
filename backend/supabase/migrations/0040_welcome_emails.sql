-- One-time "download the app" email for users who signed up but haven't
-- opened the desktop app or done an interview yet. Sent by the
-- welcome-email Edge Function, which pg_cron calls every hour; a row here
-- means that user was already emailed and is never emailed again.

create table public.welcome_emails (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  sent_at timestamptz not null default now(),
  resend_id text
);

alter table public.welcome_emails enable row level security;
revoke all on public.welcome_emails from anon, authenticated;

-- Users due the email: signed up over an hour ago (time to download on
-- their own first), not an admin, not banned, no interview, no desktop app
-- sign-in, and not emailed before.
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
    and u.created_at <= now() - interval '1 hour'
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

-- Same pattern as 0032_session_janitor_cron.sql. Safe for anyone to call:
-- it only ever emails due users, once each.
select cron.schedule(
  'welcome-email',
  '0 * * * *',
  $$select net.http_post(
      url := 'https://xubbwgrjvvsbfvxcuzav.supabase.co/functions/v1/welcome-email',
      headers := '{"content-type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1YmJ3Z3JqdnZzYmZ2eGN1emF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NzQ5NjAsImV4cCI6MjEwMjQ1MDk2MH0.ZBkDqETqfJFcrmx68wQCqE2RsfvDwyy_k7uJvlY3vJo"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    )$$
);
