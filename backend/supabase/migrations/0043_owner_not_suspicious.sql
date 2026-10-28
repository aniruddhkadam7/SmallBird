-- Owner accounts (the ones on the admin allowlist) hold minutes they never
-- bought, so the "balance above 15 free + purchased" rule flagged the owner
-- as suspicious. Owners are now never flagged -- on the users list, the
-- dashboard count, the abuse page or the flagged-sessions filter -- and the
-- users list / user detail say which accounts are owners.

drop function public.admin_list_users(text, text, boolean, int, int, text);

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
    )
    select
      user_id, email, display_name, created_at, last_sign_in_at, plan_id, remaining_minutes,
      total_purchased_minutes, total_consumed_minutes, interview_count, transcript_count, is_suspicious,
      devices, last_seen_at, is_owner, count(*) over () as total_count
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
          'isOwner', exists (select 1 from public.admin_users a where a.user_id = u.id),
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
        where not exists (select 1 from public.admin_users a where a.user_id = e.user_id)
          and e.remaining_minutes > 15 + coalesce((
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

create or replace function public.admin_abuse_flags()
returns table (severity text, category text, user_id uuid, email text, message text, detected_at timestamptz)
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.* from (
    select * from (
      select 'RED' as severity, 'entitlement_ceiling_exceeded' as category, e.user_id, u.email::text as email,
        format('Balance %s min exceeds honest ceiling of %s min (15 free-tier + %s purchased)',
          e.remaining_minutes, 15 + coalesce(pu.total, 0), coalesce(pu.total, 0)) as message,
        e.updated_at as detected_at
      from public.entitlements e
      join auth.users u on u.id = e.user_id
      left join (
        select pur.user_id, sum(p.included_minutes) as total from public.purchases pur join public.plans p on p.id = pur.plan_id group by pur.user_id
      ) pu on pu.user_id = e.user_id
      where e.remaining_minutes > 15 + coalesce(pu.total, 0)

      union all

      select 'RED', 'negative_balance', e.user_id, u.email::text,
        format('Balance is negative: %s min', e.remaining_minutes), e.updated_at
      from public.entitlements e join auth.users u on u.id = e.user_id
      where e.remaining_minutes < 0

      union all

      select 'YELLOW', 'concurrent_device_usage', s.user_id, u.email::text,
        format('%s session(s) force-ended by another device in the last 7 days', count(*)), max(s.started_at)
      from public.interview_sessions s join auth.users u on u.id = s.user_id
      where s.termination_reason = 'force_ended_by_new_login' and s.started_at > now() - interval '7 days'
      group by s.user_id, u.email having count(*) >= 2

      union all

      select 'YELLOW', 'unusually_long_session', s.user_id, u.email::text,
        format('Session %s ran %s minutes', s.id, round(s.actual_duration_seconds / 60.0, 1)), s.started_at
      from public.interview_sessions s join auth.users u on u.id = s.user_id
      where s.actual_duration_seconds > 1800

      union all

      select 'YELLOW', 'high_ai_usage', c.user_id, u.email::text,
        format('%s tokens used this account -- %sx the average user (%s tokens)',
          sum(c.input_tokens + c.output_tokens),
          round(sum(c.input_tokens + c.output_tokens) / nullif(avg_tok.avg_tokens, 0), 1), round(avg_tok.avg_tokens)),
        max(c.created_at)
      from public.usage_costs c
      join auth.users u on u.id = c.user_id
      cross join lateral (
        select avg(total) as avg_tokens from (select sum(input_tokens + output_tokens) as total from public.usage_costs group by user_id) per_user
      ) avg_tok
      group by c.user_id, u.email, avg_tok.avg_tokens
      having avg_tok.avg_tokens > 0 and sum(c.input_tokens + c.output_tokens) > 3 * avg_tok.avg_tokens
    ) flags
    where not exists (select 1 from public.admin_users a where a.user_id = flags.user_id)
    order by severity, detected_at desc
  ) f cross join _auth;
$$;

revoke all on function public.admin_abuse_flags() from public, anon, authenticated;
grant execute on function public.admin_abuse_flags() to authenticated, service_role;

create or replace function public.admin_list_sessions(
  p_search text default null,
  p_status text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_suspicious_only boolean default false,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  session_id uuid, user_id uuid, email text, plan_id text, started_at timestamptz, ended_at timestamptz, status text,
  termination_reason text, minutes_consumed numeric, actual_duration_seconds integer, authorized_max_duration_seconds integer,
  usage_deducted boolean, stt_mode text, cloud_stt_provider text, llm_calls bigint, is_suspicious boolean,
  transcript_id uuid, transcript_turn_count integer, total_count bigint
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
        t.transcript_id, t.turn_count as transcript_turn_count
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
        and (p_status is null or status = p_status)
        and (p_date_from is null or started_at >= p_date_from)
        and (p_date_to is null or started_at <= p_date_to)
        and (not p_suspicious_only or is_suspicious)
    )
    select *, count(*) over () as total_count from filtered order by started_at desc limit p_limit offset p_offset
  ) f cross join _auth;
$$;

revoke all on function public.admin_list_sessions(text, text, timestamptz, timestamptz, boolean, int, int) from public, anon, authenticated;
grant execute on function public.admin_list_sessions(text, text, timestamptz, timestamptz, boolean, int, int) to authenticated, service_role;
