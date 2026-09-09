-- Further latency fix: every admin-* read still made two sequential
-- Postgres round trips per request -- one to admin_whoami() (the fast-path
-- auth check from 0022), then a second for the actual query. This migration
-- embeds the admin check directly inside each read function via a leading
-- CTE, so a single RPC call does both -- one Postgres round trip instead of
-- two. Because these are SECURITY DEFINER functions, they already bypass
-- RLS on the underlying tables regardless of caller role, so the
-- corresponding Edge Functions can now call these using the CALLER's own
-- JWT-bearing client (verified locally by PostgREST, no extra hop) instead
-- of needing the service-role client at all for reads.
--
-- current_admin_user_id() raises 'insufficient_privilege' (SQLSTATE 42501)
-- when the caller isn't on the allowlist -- PostgREST maps that SQLSTATE to
-- HTTP 403 automatically, so the Edge Function doesn't need to inspect
-- anything beyond the error code.
create function public.current_admin_user_id()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select user_id into v_id from public.admin_users where user_id = auth.uid();
  if v_id is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return v_id;
end;
$$;

revoke execute on function public.current_admin_user_id() from public;
grant execute on function public.current_admin_user_id() to authenticated, service_role;

-- Each function below is wrapped as: `with _auth as (select
-- current_admin_user_id()) select f.* from (<original body>) f cross join
-- _auth`. The CROSS JOIN forces current_admin_user_id() to execute exactly
-- once regardless of how many rows the original query returns (including
-- zero -- a WHERE-clause scalar-subquery check would NOT be safe here,
-- since it can short-circuit to true on an empty relation).

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
      )
    )
  ) f cross join _auth;
$$;

revoke all on function public.admin_dashboard_stats() from public, anon, authenticated;
grant execute on function public.admin_dashboard_stats() to authenticated, service_role;

create or replace function public.admin_list_users(
  p_search text default null,
  p_plan_filter text default null,
  p_suspicious_only boolean default false,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  user_id uuid, email text, display_name text, created_at timestamptz, last_sign_in_at timestamptz,
  plan_id text, remaining_minutes numeric, total_purchased_minutes numeric, total_consumed_minutes numeric,
  interview_count bigint, transcript_count bigint, is_suspicious boolean, total_count bigint
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
        coalesce((select count(*) from public.interview_transcripts t where t.user_id = u.id), 0) as transcript_count
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
    )
    select *, count(*) over () as total_count from filtered order by created_at desc limit p_limit offset p_offset
  ) f cross join _auth;
$$;

revoke all on function public.admin_list_users(text, text, boolean, int, int) from public, anon, authenticated;
grant execute on function public.admin_list_users(text, text, boolean, int, int) to authenticated, service_role;

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
        select jsonb_build_object('userId', u.id, 'email', u.email, 'displayName', pr.display_name, 'createdAt', u.created_at, 'lastSignInAt', u.last_sign_in_at)
        from auth.users u left join public.profiles pr on pr.id = u.id where u.id = p_user_id
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
      'recentSessions', (
        select coalesce(jsonb_agg(to_jsonb(s2)), '[]'::jsonb) from (
          select id, started_at, ended_at, status, minutes_consumed, actual_duration_seconds, usage_deducted, termination_reason
          from public.interview_sessions where user_id = p_user_id order by started_at desc limit 50
        ) s2
      ),
      'usageCostsSummary', (
        select jsonb_build_object(
          'totalInputTokens', coalesce(sum(input_tokens), 0), 'totalOutputTokens', coalesce(sum(output_tokens), 0),
          'totalCalls', count(*), 'estimatedCostUsd', coalesce(sum(estimated_cost_usd), 0)
        )
        from public.usage_costs where user_id = p_user_id
      ),
      'transcriptCount', (select count(*) from public.interview_transcripts where user_id = p_user_id)
    )
  ) f cross join _auth;
$$;

revoke all on function public.admin_user_detail(uuid) from public, anon, authenticated;
grant execute on function public.admin_user_detail(uuid) to authenticated, service_role;

create or replace function public.admin_list_sessions(
  p_search text default null, p_status text default null, p_date_from timestamptz default null,
  p_date_to timestamptz default null, p_suspicious_only boolean default false, p_limit int default 50, p_offset int default 0
)
returns table (
  session_id uuid, user_id uuid, email text, plan_id text, started_at timestamptz, ended_at timestamptz,
  status text, termination_reason text, minutes_consumed numeric, actual_duration_seconds int,
  authorized_max_duration_seconds int, usage_deducted boolean, stt_mode text, cloud_stt_provider text,
  llm_calls bigint, is_suspicious boolean, total_count bigint
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
        coalesce(s.termination_reason = 'force_ended_by_new_login', false) as is_suspicious
      from public.interview_sessions s join auth.users u on u.id = s.user_id
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

create or replace function public.admin_list_transcripts(p_search text default null, p_user_id uuid default null, p_limit int default 50, p_offset int default 0)
returns table (
  transcript_id uuid, user_id uuid, email text, role text, company text, started_at_ms bigint,
  ended_at_ms bigint, turn_count int, created_at timestamptz, total_count bigint
)
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.* from (
    with base as (
      select t.id as transcript_id, t.user_id, u.email::text as email, t.role, t.company, t.started_at_ms,
             t.ended_at_ms, jsonb_array_length(coalesce(t.turns, '[]'::jsonb)) as turn_count, t.created_at
      from public.interview_transcripts t join auth.users u on u.id = t.user_id
    ),
    filtered as (
      select * from base
      where (p_search is null or p_search = '' or email ilike '%' || p_search || '%' or role ilike '%' || p_search || '%' or company ilike '%' || p_search || '%')
        and (p_user_id is null or user_id = p_user_id)
    )
    select *, count(*) over () as total_count from filtered order by created_at desc limit p_limit offset p_offset
  ) f cross join _auth;
$$;

revoke all on function public.admin_list_transcripts(text, uuid, int, int) from public, anon, authenticated;
grant execute on function public.admin_list_transcripts(text, uuid, int, int) to authenticated, service_role;

create or replace function public.admin_transcript_detail(p_transcript_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.jsonb_build_object from (
    select jsonb_build_object(
      'id', t.id, 'userId', t.user_id, 'email', u.email, 'role', t.role, 'company', t.company,
      'startedAtMs', t.started_at_ms, 'endedAtMs', t.ended_at_ms, 'turns', t.turns, 'createdAt', t.created_at
    )
    from public.interview_transcripts t join auth.users u on u.id = t.user_id where t.id = p_transcript_id
  ) f cross join _auth;
$$;

revoke all on function public.admin_transcript_detail(uuid) from public, anon, authenticated;
grant execute on function public.admin_transcript_detail(uuid) to authenticated, service_role;

create or replace function public.admin_list_payments(p_search text default null, p_limit int default 50, p_offset int default 0)
returns table (
  ledger_id bigint, user_id uuid, email text, minutes_granted numeric, reference_id text, created_at timestamptz,
  webhook_recorded boolean, amount_paise int, purchase_plan_id text, subscription_plan text,
  subscription_status text, total_count bigint
)
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.* from (
    with base as (
      select
        l.id as ledger_id, l.user_id, u.email::text as email, l.delta as minutes_granted, l.reference_id, l.created_at,
        exists(select 1 from public.webhook_events w where w.entity_id = l.reference_id) as webhook_recorded,
        pu.amount_paise, pu.plan_id as purchase_plan_id, sub.plan as subscription_plan, sub.status as subscription_status
      from public.entitlement_ledger l
      join auth.users u on u.id = l.user_id
      left join public.purchases pu on pu.razorpay_order_id = l.reference_id
      left join public.subscriptions sub on sub.user_id = l.user_id
      where l.source = 'PURCHASE'
    ),
    filtered as (
      select * from base where (p_search is null or p_search = '' or email ilike '%' || p_search || '%' or reference_id ilike '%' || p_search || '%')
    )
    select *, count(*) over () as total_count from filtered order by created_at desc limit p_limit offset p_offset
  ) f cross join _auth;
$$;

revoke all on function public.admin_list_payments(text, int, int) from public, anon, authenticated;
grant execute on function public.admin_list_payments(text, int, int) to authenticated, service_role;

create or replace function public.admin_list_subscriptions(p_search text default null, p_status text default null, p_limit int default 50, p_offset int default 0)
returns table (
  subscription_id uuid, user_id uuid, email text, plan text, status text, current_period_end timestamptz,
  created_at timestamptz, updated_at timestamptz, total_count bigint
)
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.* from (
    with base as (
      select s.id as subscription_id, s.user_id, u.email::text as email, s.plan, s.status, s.current_period_end, s.created_at, s.updated_at
      from public.subscriptions s join auth.users u on u.id = s.user_id
    ),
    filtered as (
      select * from base where (p_search is null or p_search = '' or email ilike '%' || p_search || '%') and (p_status is null or status = p_status)
    )
    select *, count(*) over () as total_count from filtered order by created_at desc limit p_limit offset p_offset
  ) f cross join _auth;
$$;

revoke all on function public.admin_list_subscriptions(text, text, int, int) from public, anon, authenticated;
grant execute on function public.admin_list_subscriptions(text, text, int, int) to authenticated, service_role;

create or replace function public.admin_system_health()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.jsonb_build_object from (
    select jsonb_build_object(
      'sessionsStuckActive', (select count(*) from public.interview_sessions where status = 'active' and started_at < now() - interval '10 minutes'),
      'failedSessions24h', (select count(*) from public.interview_sessions where status in ('terminated', 'expired') and started_at > now() - interval '24 hours'),
      'failedSessions7d', (select count(*) from public.interview_sessions where status in ('terminated', 'expired') and started_at > now() - interval '7 days'),
      'webhookEventsLast24h', (select count(*) from public.webhook_events where created_at > now() - interval '24 hours'),
      'lastWebhookEventAt', (select max(created_at) from public.webhook_events),
      'lastEntitlementLedgerWriteAt', (select max(created_at) from public.entitlement_ledger),
      'lastInterviewSessionAt', (select max(started_at) from public.interview_sessions),
      'sessionsMissingDuration7d', (
        select count(*) from public.interview_sessions
        where status in ('completed', 'expired') and minutes_consumed is null and started_at > now() - interval '7 days'
      )
    )
  ) f cross join _auth;
$$;

revoke all on function public.admin_system_health() from public, anon, authenticated;
grant execute on function public.admin_system_health() to authenticated, service_role;

create or replace function public.admin_ai_usage_summary()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.jsonb_build_object from (
    select jsonb_build_object(
      'tokensToday', (select coalesce(sum(input_tokens + output_tokens), 0) from public.usage_costs where created_at >= date_trunc('day', now())),
      'tokensThisWeek', (select coalesce(sum(input_tokens + output_tokens), 0) from public.usage_costs where created_at >= date_trunc('week', now())),
      'tokensThisMonth', (select coalesce(sum(input_tokens + output_tokens), 0) from public.usage_costs where created_at >= date_trunc('month', now())),
      'estimatedCostUsd', (select coalesce(sum(estimated_cost_usd), 0) from public.usage_costs),
      'byModel', (
        select coalesce(jsonb_agg(row), '[]'::jsonb) from (
          select jsonb_build_object('model', model, 'provider', provider, 'calls', count(*), 'totalTokens', sum(input_tokens + output_tokens), 'estimatedCostUsd', coalesce(sum(estimated_cost_usd), 0)) as row
          from public.usage_costs group by model, provider order by sum(input_tokens + output_tokens) desc
        ) m
      ),
      'byUser', (
        select coalesce(jsonb_agg(row), '[]'::jsonb) from (
          select jsonb_build_object('userId', c.user_id, 'email', u.email, 'calls', count(*), 'totalTokens', sum(c.input_tokens + c.output_tokens), 'estimatedCostUsd', coalesce(sum(c.estimated_cost_usd), 0)) as row
          from public.usage_costs c join auth.users u on u.id = c.user_id group by c.user_id, u.email order by sum(c.input_tokens + c.output_tokens) desc limit 50
        ) m
      )
    )
  ) f cross join _auth;
$$;

revoke all on function public.admin_ai_usage_summary() from public, anon, authenticated;
grant execute on function public.admin_ai_usage_summary() to authenticated, service_role;

create or replace function public.admin_abuse_flags()
returns table (severity text, category text, user_id uuid, email text, message text, detected_at timestamptz)
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.* from (
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

    order by severity, detected_at desc
  ) f cross join _auth;
$$;

revoke all on function public.admin_abuse_flags() from public, anon, authenticated;
grant execute on function public.admin_abuse_flags() to authenticated, service_role;

create or replace function public.admin_data_integrity_checks()
returns table (severity text, check_name text, user_id uuid, email text, message text)
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.* from (
    select 'RED' as severity, 'missing_entitlement' as check_name, u.id as user_id, u.email::text as email,
      'User has no entitlements row -- every edge function call for this user will 403' as message
    from auth.users u left join public.entitlements e on e.user_id = u.id where e.user_id is null

    union all

    select 'YELLOW', 'paid_plan_without_purchase_record', e.user_id, u.email::text,
      format('Plan is "%s" but there is no purchases or subscriptions row for this user', e.plan_id)
    from public.entitlements e join auth.users u on u.id = e.user_id
    where e.plan_id <> 'free'
      and not exists (select 1 from public.purchases p where p.user_id = e.user_id)
      and not exists (select 1 from public.subscriptions s where s.user_id = e.user_id)

    union all

    select 'RED', 'duplicate_subscriptions', s.user_id, u.email::text,
      format('%s subscriptions rows for this user (expected at most 1)', count(*))
    from public.subscriptions s join auth.users u on u.id = s.user_id
    group by s.user_id, u.email having count(*) > 1

    union all

    select 'YELLOW', 'session_missing_duration', s.user_id, u.email::text,
      format('Session %s is "%s" but has no minutes_consumed recorded', s.id, s.status)
    from public.interview_sessions s join auth.users u on u.id = s.user_id
    where s.status in ('completed', 'expired') and s.minutes_consumed is null

    union all

    select 'RED', 'ledger_balance_mismatch', e.user_id, u.email::text,
      format('Ledger sums to %s but live balance is %s', coalesce(t.running_total, 0), e.remaining_minutes)
    from public.entitlements e
    join auth.users u on u.id = e.user_id
    left join (select user_id, sum(delta) as running_total from public.entitlement_ledger group by user_id) t on t.user_id = e.user_id
    where e.remaining_minutes <> coalesce(t.running_total, 0)
  ) f cross join _auth;
$$;

revoke all on function public.admin_data_integrity_checks() from public, anon, authenticated;
grant execute on function public.admin_data_integrity_checks() to authenticated, service_role;
