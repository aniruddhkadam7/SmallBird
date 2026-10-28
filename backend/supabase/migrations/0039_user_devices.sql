-- Records which kind of device each user signs in and runs interviews from,
-- so the admin console can tell a user who only signed up on the website
-- apart from one who installed the desktop app (Windows or Mac) or uses the
-- phone/browser page.
--
-- client_kind:
--   'desktop' -- the Tauri app (sends x-smallbird-client, or no browser UA)
--   'browser' -- the web/phone page, called straight from a browser
--   'website' -- the website's server signed the user in (device unknown)
-- os: 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'unknown'
--
-- Written only by the Edge Functions (service role) through
-- record_user_device(); read only through the admin_* functions below.

create table public.user_devices (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  client_kind text not null check (client_kind in ('desktop', 'browser', 'website')),
  os text not null default 'unknown' check (os in ('windows', 'macos', 'linux', 'android', 'ios', 'unknown')),
  app_version text,
  user_agent text,
  last_ip text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  sign_in_count int not null default 0,
  session_count int not null default 0,
  unique (user_id, client_kind, os)
);

create index user_devices_user_id_idx on public.user_devices (user_id);

alter table public.user_devices enable row level security;
revoke all on public.user_devices from anon, authenticated;

-- Which device each interview session ran on (null for sessions started
-- before this migration).
alter table public.interview_sessions
  add column client_kind text,
  add column client_os text;

create or replace function public.record_user_device(
  p_user_id uuid,
  p_client_kind text,
  p_os text,
  p_app_version text,
  p_user_agent text,
  p_ip text,
  p_event text -- 'sign_in' | 'session'
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_devices as d
    (user_id, client_kind, os, app_version, user_agent, last_ip, sign_in_count, session_count)
  values (
    p_user_id, p_client_kind, coalesce(p_os, 'unknown'), p_app_version, left(p_user_agent, 500), p_ip,
    case when p_event = 'sign_in' then 1 else 0 end,
    case when p_event = 'session' then 1 else 0 end
  )
  on conflict (user_id, client_kind, os) do update set
    app_version = coalesce(excluded.app_version, d.app_version),
    user_agent = coalesce(excluded.user_agent, d.user_agent),
    last_ip = coalesce(excluded.last_ip, d.last_ip),
    last_seen_at = now(),
    sign_in_count = d.sign_in_count + excluded.sign_in_count,
    session_count = d.session_count + excluded.session_count;
$$;

revoke all on function public.record_user_device(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_user_device(uuid, text, text, text, text, text, text) to service_role;

-- Backfill from the sign-ins Supabase Auth already logged. A browser user
-- agent means the user signed in from a browser on that OS; the website's
-- server ('node' / 'Vercel Edge Functions') only tells us they used the
-- website. Desktop sign-ins carry no user agent here, so they can't be
-- backfilled -- they start showing up from the next sign-in or session.
insert into public.user_devices (user_id, client_kind, os, user_agent, last_ip, first_seen_at, last_seen_at, sign_in_count)
select
  s.user_id,
  k.client_kind,
  k.os,
  max(s.user_agent),
  max(host(s.ip)),
  min(s.created_at),
  max(coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at)),
  count(*)
from auth.sessions s
cross join lateral (
  select
    case when s.user_agent ilike 'mozilla/%' then 'browser' else 'website' end as client_kind,
    case
      when s.user_agent not ilike 'mozilla/%' then 'unknown'
      when s.user_agent ~* 'iphone|ipad|ipod' then 'ios'
      when s.user_agent ~* 'android' then 'android'
      when s.user_agent ~* 'windows' then 'windows'
      when s.user_agent ~* 'macintosh|mac os x' then 'macos'
      when s.user_agent ~* 'linux|cros' then 'linux'
      else 'unknown'
    end as os
) k
where s.user_agent ilike 'mozilla/%' or s.user_agent in ('node', 'Vercel Edge Functions')
group by s.user_id, k.client_kind, k.os
on conflict (user_id, client_kind, os) do nothing;

-- ---------------------------------------------------------------------------
-- Admin reads: devices on the user list, user detail and dashboard.
-- ---------------------------------------------------------------------------

drop function public.admin_list_users(text, text, boolean, int, int);

create function public.admin_list_users(
  p_search text default null,
  p_plan_filter text default null,
  p_suspicious_only boolean default false,
  p_limit int default 50,
  p_offset int default 0,
  p_client_filter text default null -- 'desktop' | 'browser' | 'website' | 'none'
)
returns table (
  user_id uuid, email text, display_name text, created_at timestamptz, last_sign_in_at timestamptz,
  plan_id text, remaining_minutes numeric, total_purchased_minutes numeric, total_consumed_minutes numeric,
  interview_count bigint, transcript_count bigint, is_suspicious boolean, devices jsonb, last_seen_at timestamptz,
  total_count bigint
)
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.* from (
    with base as (
      select
        u.id as user_id, u.email::text as email, pr.display_name, u.created_at, u.last_sign_in_at,
        e.plan_id, e.remaining_minutes,
        coalesce((select sum(p.included_minutes) from public.purchases pu join public.plans p on p.id = pu.plan_id where pu.user_id = u.id), 0) as total_purchased_minutes,
        coalesce((select sum(s.minutes_consumed) from public.interview_sessions s where s.user_id = u.id and s.minutes_consumed is not null), 0) as total_consumed_minutes,
        coalesce((select count(*) from public.interview_sessions s where s.user_id = u.id), 0) as interview_count,
        coalesce((select count(*) from public.interview_transcripts t where t.user_id = u.id), 0) as transcript_count,
        coalesce((
          select jsonb_agg(jsonb_build_object('kind', d.client_kind, 'os', d.os, 'appVersion', d.app_version, 'lastSeenAt', d.last_seen_at) order by d.last_seen_at desc)
          from public.user_devices d where d.user_id = u.id
        ), '[]'::jsonb) as devices,
        greatest(u.last_sign_in_at, (select max(d.last_seen_at) from public.user_devices d where d.user_id = u.id)) as last_seen_at
      from auth.users u
      join public.entitlements e on e.user_id = u.id
      left join public.profiles pr on pr.id = u.id
    ),
    flagged as (
      select *, (remaining_minutes > 15 + total_purchased_minutes) as is_suspicious from base
    ),
    filtered as (
      select * from flagged
      where (p_search is null or p_search = '' or email ilike '%' || p_search || '%' or user_id::text = p_search)
        and (p_plan_filter is null or (p_plan_filter = 'free' and plan_id = 'free') or (p_plan_filter = 'paid' and plan_id <> 'free'))
        and (not p_suspicious_only or is_suspicious)
        and (
          p_client_filter is null
          or (p_client_filter = 'none' and devices = '[]'::jsonb)
          or (p_client_filter <> 'none' and devices @> jsonb_build_array(jsonb_build_object('kind', p_client_filter)))
        )
    )
    select
      user_id, email, display_name, created_at, last_sign_in_at, plan_id, remaining_minutes,
      total_purchased_minutes, total_consumed_minutes, interview_count, transcript_count, is_suspicious,
      devices, last_seen_at, count(*) over () as total_count
    from filtered order by created_at desc limit p_limit offset p_offset
  ) f cross join _auth;
$$;

revoke all on function public.admin_list_users(text, text, boolean, int, int, text) from public, anon, authenticated;
grant execute on function public.admin_list_users(text, text, boolean, int, int, text) to authenticated, service_role;

create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.jsonb_build_object from (
    select jsonb_build_object(
      'profile', (
        select jsonb_build_object(
          'userId', u.id, 'email', u.email, 'displayName', pr.display_name,
          'createdAt', u.created_at, 'lastSignInAt', u.last_sign_in_at,
          'signUpProvider', u.raw_app_meta_data->>'provider',
          'isBanned', coalesce(pr.is_banned, false),
          'banReason', pr.ban_reason,
          'bannedAt', pr.banned_at,
          'bannedByEmail', pr.banned_by_email
        )
        from auth.users u left join public.profiles pr on pr.id = u.id where u.id = p_user_id
      ),
      'devices', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'kind', d.client_kind, 'os', d.os, 'appVersion', d.app_version, 'userAgent', d.user_agent,
          'lastIp', d.last_ip, 'firstSeenAt', d.first_seen_at, 'lastSeenAt', d.last_seen_at,
          'signInCount', d.sign_in_count, 'sessionCount', d.session_count
        ) order by d.last_seen_at desc), '[]'::jsonb)
        from public.user_devices d where d.user_id = p_user_id
      ),
      'entitlement', (
        select jsonb_build_object('planId', plan_id, 'remainingMinutes', remaining_minutes, 'periodStart', period_start, 'periodEnd', period_end, 'updatedAt', updated_at)
        from public.entitlements where user_id = p_user_id
      ),
      'ledger', (
        select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc), '[]'::jsonb)
        from public.entitlement_ledger l where l.user_id = p_user_id
      ),
      'purchases', (
        select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc), '[]'::jsonb)
        from public.purchases p where p.user_id = p_user_id
      ),
      'subscriptions', (
        select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.subscriptions s where s.user_id = p_user_id
      ),
      'sessionsSummary', (
        select jsonb_build_object(
          'total', count(*), 'totalMinutesConsumed', coalesce(sum(minutes_consumed), 0),
          'completed', count(*) filter (where status = 'completed'),
          'terminated', count(*) filter (where status = 'terminated'),
          'expired', count(*) filter (where status = 'expired'),
          'active', count(*) filter (where status = 'active')
        )
        from public.interview_sessions where user_id = p_user_id
      ),
      'sessions', (
        select coalesce(jsonb_agg(to_jsonb(s2) order by s2.started_at desc), '[]'::jsonb) from (
          select s.id, s.started_at, s.ended_at, s.status, s.minutes_consumed, s.actual_duration_seconds,
                 s.usage_deducted, s.termination_reason, s.client_kind, s.client_os,
                 t.transcript_id, t.turn_count as transcript_turn_count
          from public.interview_sessions s
          left join lateral (
            select it.id as transcript_id, jsonb_array_length(coalesce(it.turns, '[]'::jsonb)) as turn_count
            from public.interview_transcripts it
            where it.user_id = s.user_id
              and to_timestamp(it.started_at_ms / 1000.0) >= s.started_at - interval '2 minutes'
              and to_timestamp(it.started_at_ms / 1000.0) <= coalesce(s.ended_at, s.started_at + interval '3 hours') + interval '2 minutes'
            order by abs(extract(epoch from (to_timestamp(it.started_at_ms / 1000.0) - s.started_at)))
            limit 1
          ) t on true
          where s.user_id = p_user_id
        ) s2
      ),
      'usageCostsSummary', (
        select jsonb_build_object(
          'totalInputTokens', coalesce(sum(input_tokens), 0), 'totalOutputTokens', coalesce(sum(output_tokens), 0),
          'totalCalls', count(*), 'estimatedCostUsd', coalesce(sum(estimated_cost_usd), 0)
        )
        from public.usage_costs where user_id = p_user_id
      ),
      'transcripts', (
        select coalesce(jsonb_agg(to_jsonb(t2) order by t2.created_at desc), '[]'::jsonb) from (
          select id, role, company, started_at_ms, ended_at_ms,
                 jsonb_array_length(coalesce(turns, '[]'::jsonb)) as turn_count, created_at
          from public.interview_transcripts where user_id = p_user_id
        ) t2
      ),
      'transcriptCount', (select count(*) from public.interview_transcripts where user_id = p_user_id)
    )
  ) f cross join _auth;
$$;

revoke all on function public.admin_user_detail(uuid) from public, anon, authenticated;
grant execute on function public.admin_user_detail(uuid) to authenticated, service_role;

create or replace function public.admin_dashboard_stats()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.jsonb_build_object from (
    select jsonb_build_object(
      'totalUsers', (select count(*) from public.entitlements),
      'freeUsers', (select count(*) from public.entitlements where plan_id = 'free'),
      'paidUsers', (select count(*) from public.entitlements where plan_id <> 'free'),
      'activeSubscriptions', (select count(*) from public.subscriptions where status = 'active'),
      'expiredSubscriptions', (select count(*) from public.subscriptions where status in ('canceled', 'halted')),
      'totalMinutesPurchased', (
        select coalesce(sum(p.included_minutes), 0)
        from public.purchases pu join public.plans p on p.id = pu.plan_id
      ),
      'totalMinutesConsumed', (
        select coalesce(sum(minutes_consumed), 0) from public.interview_sessions where minutes_consumed is not null
      ),
      'totalMinutesRemaining', (select coalesce(sum(remaining_minutes), 0) from public.entitlements),
      'totalInterviews', (select count(*) from public.interview_sessions),
      'interviewsToday', (select count(*) from public.interview_sessions where started_at >= date_trunc('day', now())),
      'interviewsThisWeek', (select count(*) from public.interview_sessions where started_at >= date_trunc('week', now())),
      'interviewsThisMonth', (select count(*) from public.interview_sessions where started_at >= date_trunc('month', now())),
      'totalTranscripts', (select count(*) from public.interview_transcripts),
      'totalAiTokens', (select coalesce(sum(input_tokens + output_tokens), 0) from public.usage_costs),
      'estimatedAiCostUsd', (select coalesce(sum(estimated_cost_usd), 0) from public.usage_costs),
      'failedSessions', (select count(*) from public.interview_sessions where status in ('terminated', 'expired')),
      'suspiciousAccounts', (
        select count(*) from public.entitlements e
        where e.remaining_minutes > 15 + coalesce((
          select sum(p.included_minutes) from public.purchases pu
          join public.plans p on p.id = pu.plan_id
          where pu.user_id = e.user_id
        ), 0)
      ),
      'signupsToday', (select count(*) from auth.users where created_at >= date_trunc('day', now())),
      'signupsThisWeek', (select count(*) from auth.users where created_at >= date_trunc('week', now())),
      'signupsThisMonth', (select count(*) from auth.users where created_at >= date_trunc('month', now())),
      'activeUsers7d', (
        select count(distinct x.user_id) from (
          select id as user_id from auth.users where last_sign_in_at >= now() - interval '7 days'
          union all
          select user_id from public.user_devices where last_seen_at >= now() - interval '7 days'
        ) x
      ),
      'usersNeverInterviewed', (
        select count(*) from public.entitlements e
        where not exists (select 1 from public.interview_sessions s where s.user_id = e.user_id)
      ),
      'devices', jsonb_build_object(
        'desktopUsers', (select count(distinct user_id) from public.user_devices where client_kind = 'desktop'),
        'desktopWindows', (select count(distinct user_id) from public.user_devices where client_kind = 'desktop' and os = 'windows'),
        'desktopMac', (select count(distinct user_id) from public.user_devices where client_kind = 'desktop' and os = 'macos'),
        'browserUsers', (select count(distinct user_id) from public.user_devices where client_kind = 'browser'),
        'phoneUsers', (select count(distinct user_id) from public.user_devices where client_kind = 'browser' and os in ('android', 'ios')),
        'androidUsers', (select count(distinct user_id) from public.user_devices where client_kind = 'browser' and os = 'android'),
        'iosUsers', (select count(distinct user_id) from public.user_devices where client_kind = 'browser' and os = 'ios'),
        'computerBrowserUsers', (select count(distinct user_id) from public.user_devices where client_kind = 'browser' and os in ('windows', 'macos', 'linux')),
        'websiteOnlyUsers', (
          select count(*) from public.entitlements e
          where not exists (select 1 from public.user_devices d where d.user_id = e.user_id and d.client_kind in ('desktop', 'browser'))
        )
      )
    )
  ) f cross join _auth;
$$;

revoke all on function public.admin_dashboard_stats() from public, anon, authenticated;
grant execute on function public.admin_dashboard_stats() to authenticated, service_role;
