-- Every Home card now opens a list of exactly what it counted. The users
-- and sessions lists gain the filters for that (p_segment, p_period), and
-- "today / this week / this month" means India time everywhere -- on the
-- cards and in the lists -- instead of UTC, so the counts match.

create or replace function public.admin_period_start(p_period text)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select date_trunc(
    case p_period when 'today' then 'day' when 'week' then 'week' when 'month' then 'month' end,
    now() at time zone 'Asia/Kolkata'
  ) at time zone 'Asia/Kolkata';
$$;

grant execute on function public.admin_period_start(text) to authenticated, service_role;

drop function public.admin_list_users(text, text, boolean, int, int, text);
drop function public.admin_list_sessions(text, text, timestamptz, timestamptz, boolean, int, int);

create function public.admin_list_users(
  p_search text default null,
  p_plan_filter text default null,
  p_suspicious_only boolean default false,
  p_limit int default 50,
  p_offset int default 0,
  p_client_filter text default null, -- 'desktop' | 'browser' | 'website' | 'none'
  p_segment text default null -- what a dashboard card counted; see below
)
returns table (
  user_id uuid, email text, display_name text, created_at timestamptz, last_sign_in_at timestamptz,
  plan_id text, remaining_minutes numeric, total_purchased_minutes numeric, total_consumed_minutes numeric,
  interview_count bigint, transcript_count bigint, is_suspicious boolean, devices jsonb, last_seen_at timestamptz,
  is_owner boolean, total_count bigint
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
        greatest(u.last_sign_in_at, (select max(d.last_seen_at) from public.user_devices d where d.user_id = u.id)) as last_seen_at,
        exists (select 1 from public.admin_users a where a.user_id = u.id) as is_owner
      from auth.users u
      join public.entitlements e on e.user_id = u.id
      left join public.profiles pr on pr.id = u.id
    ),
    flagged as (
      select *, (not is_owner and remaining_minutes > 15 + total_purchased_minutes) as is_suspicious from base
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
        and (
          p_segment is null
          or (p_segment = 'joined_today' and created_at >= public.admin_period_start('today'))
          or (p_segment = 'joined_week' and created_at >= public.admin_period_start('week'))
          or (p_segment = 'joined_month' and created_at >= public.admin_period_start('month'))
          or (p_segment = 'active_7d' and last_seen_at >= now() - interval '7 days')
          or (p_segment = 'interviewed' and interview_count > 0)
          or (p_segment = 'never_interviewed' and interview_count = 0)
          or (p_segment = 'desktop_windows' and devices @> '[{"kind":"desktop","os":"windows"}]')
          or (p_segment = 'desktop_mac' and devices @> '[{"kind":"desktop","os":"macos"}]')
          or (p_segment = 'android' and devices @> '[{"kind":"browser","os":"android"}]')
          or (p_segment = 'ios' and devices @> '[{"kind":"browser","os":"ios"}]')
          or (p_segment = 'computer_browser' and exists (
                select 1 from jsonb_array_elements(devices) d
                where d->>'kind' = 'browser' and d->>'os' in ('windows', 'macos', 'linux')))
          or (p_segment = 'website_only' and not exists (
                select 1 from jsonb_array_elements(devices) d where d->>'kind' in ('desktop', 'browser')))
        )
    )
    select
      user_id, email, display_name, created_at, last_sign_in_at, plan_id, remaining_minutes,
      total_purchased_minutes, total_consumed_minutes, interview_count, transcript_count, is_suspicious,
      devices, last_seen_at, is_owner, count(*) over () as total_count
    from filtered order by created_at desc limit p_limit offset p_offset
  ) f cross join _auth;
$$;

revoke all on function public.admin_list_users(text, text, boolean, int, int, text, text) from public, anon, authenticated;
grant execute on function public.admin_list_users(text, text, boolean, int, int, text, text) to authenticated, service_role;

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
      'interviewsToday', (select count(*) from public.interview_sessions where started_at >= public.admin_period_start('today')),
      'interviewsThisWeek', (select count(*) from public.interview_sessions where started_at >= public.admin_period_start('week')),
      'interviewsThisMonth', (select count(*) from public.interview_sessions where started_at >= public.admin_period_start('month')),
      'totalTranscripts', (select count(*) from public.interview_transcripts),
      'totalAiTokens', (select coalesce(sum(input_tokens + output_tokens), 0) from public.usage_costs),
      'estimatedAiCostUsd', (select coalesce(sum(estimated_cost_usd), 0) from public.usage_costs),
      'failedSessions', (select count(*) from public.interview_sessions where status in ('terminated', 'expired')),
      'suspiciousAccounts', (
        select count(*) from public.entitlements e
        where not exists (select 1 from public.admin_users a where a.user_id = e.user_id)
          and e.remaining_minutes > 15 + coalesce((
          select sum(p.included_minutes) from public.purchases pu
          join public.plans p on p.id = pu.plan_id
          where pu.user_id = e.user_id
        ), 0)
      ),
      'signupsToday', (select count(*) from auth.users where created_at >= public.admin_period_start('today')),
      'signupsThisWeek', (select count(*) from auth.users where created_at >= public.admin_period_start('week')),
      'signupsThisMonth', (select count(*) from auth.users where created_at >= public.admin_period_start('month')),
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

create function public.admin_list_sessions(
  p_search text default null,
  p_status text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_suspicious_only boolean default false,
  p_limit int default 50,
  p_offset int default 0,
  p_period text default null -- 'today' | 'week' | 'month'
)
returns table (
  session_id uuid, user_id uuid, email text, plan_id text, started_at timestamptz, ended_at timestamptz, status text,
  termination_reason text, minutes_consumed numeric, actual_duration_seconds integer, authorized_max_duration_seconds integer,
  usage_deducted boolean, stt_mode text, cloud_stt_provider text, llm_calls bigint, is_suspicious boolean,
  transcript_id uuid, transcript_turn_count integer, ai_answers bigint, total_count bigint
)
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.* from (
    with base as (
      select
        s.id as session_id, s.user_id, u.email::text as email, s.plan_id, s.started_at, s.ended_at, s.status,
        s.termination_reason, s.minutes_consumed, s.actual_duration_seconds, s.authorized_max_duration_seconds,
        s.usage_deducted, s.stt_mode, s.cloud_stt_provider,
        coalesce((select count(*) from public.usage_costs c where c.session_id = s.id), 0) as llm_calls,
        coalesce(s.termination_reason = 'force_ended_by_new_login', false)
          and not exists (select 1 from public.admin_users a where a.user_id = s.user_id) as is_suspicious,
        t.transcript_id, t.turn_count as transcript_turn_count,
        (select count(*) from public.usage_costs c where c.user_id = s.user_id
                   and c.created_at between s.started_at and coalesce(s.ended_at, s.started_at + interval '3 hours')) as ai_answers
      from public.interview_sessions s
      join auth.users u on u.id = s.user_id
      left join lateral (
        select it.id as transcript_id, jsonb_array_length(coalesce(it.turns, '[]'::jsonb)) as turn_count
        from public.interview_transcripts it
        where it.user_id = s.user_id
          and to_timestamp(it.started_at_ms / 1000.0) >= s.started_at - interval '2 minutes'
          and to_timestamp(it.started_at_ms / 1000.0) <= coalesce(s.ended_at, s.started_at + interval '3 hours') + interval '2 minutes'
        order by abs(extract(epoch from (to_timestamp(it.started_at_ms / 1000.0) - s.started_at)))
        limit 1
      ) t on true
    ),
    filtered as (
      select * from base
      where (p_search is null or p_search = '' or email ilike '%' || p_search || '%' or user_id::text = p_search)
        and (p_status is null or status = p_status or (p_status = 'failed' and status in ('terminated', 'expired')))
        and (p_period is null or started_at >= public.admin_period_start(p_period))
        and (p_date_from is null or started_at >= p_date_from)
        and (p_date_to is null or started_at <= p_date_to)
        and (not p_suspicious_only or is_suspicious)
    )
    select *, count(*) over () as total_count from filtered order by started_at desc limit p_limit offset p_offset
  ) f cross join _auth;
$$;

revoke all on function public.admin_list_sessions(text, text, timestamptz, timestamptz, boolean, int, int, text) from public, anon, authenticated;
grant execute on function public.admin_list_sessions(text, text, timestamptz, timestamptz, boolean, int, int, text) to authenticated, service_role;
