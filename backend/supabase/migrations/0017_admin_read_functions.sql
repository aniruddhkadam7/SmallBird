-- Read-side functions backing the admin console's dashboard/users/user-detail
-- views. All three are SECURITY DEFINER, service_role-only (same lockdown
-- pattern as 0016) so that even though the service-role client used inside
-- admin-* Edge Functions already bypasses RLS, these can never be reached by
-- anon/authenticated even if someone learned their names.

create function public.admin_dashboard_stats()
returns jsonb
language sql
security definer
set search_path = public
as $$
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
    -- Same "balance exceeds what an honest free grant + purchases could ever
    -- produce" check verified manually this session when investigating the
    -- entitlement-RPC exploit — 15 is the highest historical free-tier grant.
    'suspiciousAccounts', (
      select count(*) from public.entitlements e
      where e.remaining_minutes > 15 + coalesce((
        select sum(p.included_minutes) from public.purchases pu
        join public.plans p on p.id = pu.plan_id
        where pu.user_id = e.user_id
      ), 0)
    )
  );
$$;

revoke all on function public.admin_dashboard_stats() from public, anon, authenticated;
grant execute on function public.admin_dashboard_stats() to service_role;

-- Paginated, filterable user list. p_plan_filter is 'free' | 'paid' | null.
create function public.admin_list_users(
  p_search text default null,
  p_plan_filter text default null,
  p_suspicious_only boolean default false,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  user_id uuid,
  email text,
  display_name text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  plan_id text,
  remaining_minutes numeric,
  total_purchased_minutes numeric,
  total_consumed_minutes numeric,
  interview_count bigint,
  transcript_count bigint,
  is_suspicious boolean,
  total_count bigint
)
language sql
security definer
set search_path = public
as $$
  with base as (
    select
      u.id as user_id,
      u.email::text as email,
      pr.display_name,
      u.created_at,
      u.last_sign_in_at,
      e.plan_id,
      e.remaining_minutes,
      coalesce((
        select sum(p.included_minutes) from public.purchases pu
        join public.plans p on p.id = pu.plan_id where pu.user_id = u.id
      ), 0) as total_purchased_minutes,
      coalesce((
        select sum(s.minutes_consumed) from public.interview_sessions s
        where s.user_id = u.id and s.minutes_consumed is not null
      ), 0) as total_consumed_minutes,
      coalesce((select count(*) from public.interview_sessions s where s.user_id = u.id), 0) as interview_count,
      coalesce((select count(*) from public.interview_transcripts t where t.user_id = u.id), 0) as transcript_count
    from auth.users u
    join public.entitlements e on e.user_id = u.id
    left join public.profiles pr on pr.id = u.id
  ),
  flagged as (
    select *, (remaining_minutes > 15 + total_purchased_minutes) as is_suspicious
    from base
  ),
  filtered as (
    select * from flagged
    where (p_search is null or p_search = '' or email ilike '%' || p_search || '%' or user_id::text = p_search)
      and (p_plan_filter is null
           or (p_plan_filter = 'free' and plan_id = 'free')
           or (p_plan_filter = 'paid' and plan_id <> 'free'))
      and (not p_suspicious_only or is_suspicious)
  )
  select *, count(*) over () as total_count
  from filtered
  order by created_at desc
  limit p_limit offset p_offset;
$$;

revoke all on function public.admin_list_users(text, text, boolean, int, int) from public, anon, authenticated;
grant execute on function public.admin_list_users(text, text, boolean, int, int) to service_role;

-- Full detail payload for one user's admin profile page.
create function public.admin_user_detail(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'userId', u.id, 'email', u.email, 'displayName', pr.display_name,
        'createdAt', u.created_at, 'lastSignInAt', u.last_sign_in_at
      )
      from auth.users u left join public.profiles pr on pr.id = u.id
      where u.id = p_user_id
    ),
    'entitlement', (
      select jsonb_build_object(
        'planId', plan_id, 'remainingMinutes', remaining_minutes,
        'periodStart', period_start, 'periodEnd', period_end, 'updatedAt', updated_at
      )
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
      select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
      from public.subscriptions s where s.user_id = p_user_id
    ),
    'sessionsSummary', (
      select jsonb_build_object(
        'total', count(*),
        'totalMinutesConsumed', coalesce(sum(minutes_consumed), 0),
        'completed', count(*) filter (where status = 'completed'),
        'terminated', count(*) filter (where status = 'terminated'),
        'expired', count(*) filter (where status = 'expired'),
        'active', count(*) filter (where status = 'active')
      )
      from public.interview_sessions where user_id = p_user_id
    ),
    'recentSessions', (
      select coalesce(jsonb_agg(to_jsonb(s2)), '[]'::jsonb) from (
        select id, started_at, ended_at, status, minutes_consumed, actual_duration_seconds,
               usage_deducted, termination_reason
        from public.interview_sessions where user_id = p_user_id
        order by started_at desc limit 50
      ) s2
    ),
    'usageCostsSummary', (
      select jsonb_build_object(
        'totalInputTokens', coalesce(sum(input_tokens), 0),
        'totalOutputTokens', coalesce(sum(output_tokens), 0),
        'totalCalls', count(*),
        'estimatedCostUsd', coalesce(sum(estimated_cost_usd), 0)
      )
      from public.usage_costs where user_id = p_user_id
    ),
    'transcriptCount', (select count(*) from public.interview_transcripts where user_id = p_user_id)
  );
$$;

revoke all on function public.admin_user_detail(uuid) from public, anon, authenticated;
grant execute on function public.admin_user_detail(uuid) to service_role;
