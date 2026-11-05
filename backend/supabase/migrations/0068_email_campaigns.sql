-- Marketing email campaigns sent from the admin console (Pricing & Offers):
-- who may be emailed, who has opted out, and a record of each send so a
-- campaign can never reach the same person twice.

-- Anyone who clicked "unsubscribe" in a campaign email. Never emailed again.
create table if not exists public.email_unsubscribes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  headline text not null,
  body text not null,
  cta_label text,
  cta_href text,
  audience text not null check (audience in ('all', 'free', 'buyers', 'non_buyers')),
  status text not null default 'sending' check (status in ('sending', 'sent')),
  recipient_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_by_email text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- One row per recipient, created up front as 'queued'. The primary key and
-- claiming a row ('sending') before the email goes out make a send
-- idempotent: a retry or a double click can't send the same campaign to
-- the same person twice.
create table if not exists public.email_campaign_sends (
  campaign_id uuid not null references public.email_campaigns (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

-- Server-only: no policies, so only the service role (edge functions) can
-- read or write any of these.
alter table public.email_unsubscribes enable row level security;
alter table public.email_campaigns enable row level security;
alter table public.email_campaign_sends enable row level security;

-- People a campaign may be sent to: confirmed email, not banned, not
-- unsubscribed. `p_audience`: all | free (still on the free plan) |
-- buyers (bought a pass) | non_buyers (never bought one).
create or replace function public.campaign_audience(p_audience text)
returns table (user_id uuid, email text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id,
         u.email::text,
         nullif(trim(coalesce(p.display_name, u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), '')
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.email is not null
    and u.email_confirmed_at is not null
    and coalesce(p.is_banned, false) = false
    and not exists (select 1 from public.email_unsubscribes s where s.user_id = u.id)
    and case p_audience
          when 'all' then true
          when 'buyers' then exists (select 1 from public.purchases b where b.user_id = u.id)
          when 'non_buyers' then not exists (select 1 from public.purchases b where b.user_id = u.id)
          when 'free' then coalesce((select e.plan_id from public.entitlements e where e.user_id = u.id), 'free') = 'free'
          else false
        end;
$$;

revoke all on function public.campaign_audience(text) from public, anon, authenticated;
grant execute on function public.campaign_audience(text) to service_role;
