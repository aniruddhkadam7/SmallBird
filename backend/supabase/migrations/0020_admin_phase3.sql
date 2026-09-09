-- Phase 3 admin read functions: Abuse/Risk detection, Data Integrity checks,
-- AI Usage analytics. Same lockdown pattern as prior admin migrations.

-- ============================================================================
-- Abuse / Risk flags. Never auto-acts on anything -- purely surfaces
-- anomalies for a human to investigate, per the spec ("do NOT automatically
-- ban users based only on heuristics").
-- ============================================================================
create function public.admin_abuse_flags()
returns table (
  severity text,
  category text,
  user_id uuid,
  email text,
  message text,
  detected_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  -- RED: balance exceeds what an honest free grant + purchases could ever
  -- produce. This is the exact check that caught the entitlement-RPC
  -- exploit this session -- 15 is the highest historical free-tier grant.
  -- Column names for the whole UNION ALL come from this first branch's
  -- aliases (needed for the ORDER BY at the end to resolve).
  select 'RED' as severity, 'entitlement_ceiling_exceeded' as category, e.user_id, u.email::text as email,
    format('Balance %s min exceeds honest ceiling of %s min (15 free-tier + %s purchased)',
      e.remaining_minutes, 15 + coalesce(pu.total, 0), coalesce(pu.total, 0)) as message,
    e.updated_at as detected_at
  from public.entitlements e
  join auth.users u on u.id = e.user_id
  left join (
    select pur.user_id, sum(p.included_minutes) as total
    from public.purchases pur join public.plans p on p.id = pur.plan_id
    group by pur.user_id
  ) pu on pu.user_id = e.user_id
  where e.remaining_minutes > 15 + coalesce(pu.total, 0)

  union all

  -- RED: a negative balance should be structurally impossible (both
  -- decrement_entitlement_minutes and admin_adjust_entitlement clamp at
  -- greatest(x, 0)) -- if this ever fires, something wrote to entitlements
  -- outside those two functions.
  select 'RED', 'negative_balance', e.user_id, u.email::text,
    format('Balance is negative: %s min', e.remaining_minutes), e.updated_at
  from public.entitlements e join auth.users u on u.id = e.user_id
  where e.remaining_minutes < 0

  union all

  -- YELLOW: repeated force-terminations in the last 7 days -- evidence of
  -- the same account being used from multiple devices back-to-back.
  select 'YELLOW', 'concurrent_device_usage', s.user_id, u.email::text,
    format('%s session(s) force-ended by another device in the last 7 days', count(*)),
    max(s.started_at)
  from public.interview_sessions s
  join auth.users u on u.id = s.user_id
  where s.termination_reason = 'force_ended_by_new_login'
    and s.started_at > now() - interval '7 days'
  group by s.user_id, u.email
  having count(*) >= 2

  union all

  -- YELLOW: an interview session that ran unusually long (>30 real minutes).
  select 'YELLOW', 'unusually_long_session', s.user_id, u.email::text,
    format('Session %s ran %s minutes', s.id, round(s.actual_duration_seconds / 60.0, 1)),
    s.started_at
  from public.interview_sessions s
  join auth.users u on u.id = s.user_id
  where s.actual_duration_seconds > 1800

  union all

  -- YELLOW: token usage far above the population average -- only fires once
  -- there's enough usage_costs data for "average" to mean anything.
  select 'YELLOW', 'high_ai_usage', c.user_id, u.email::text,
    format('%s tokens used this account -- %sx the average user (%s tokens)',
      sum(c.input_tokens + c.output_tokens),
      round(sum(c.input_tokens + c.output_tokens) / nullif(avg_tok.avg_tokens, 0), 1),
      round(avg_tok.avg_tokens)),
    max(c.created_at)
  from public.usage_costs c
  join auth.users u on u.id = c.user_id
  cross join lateral (
    select avg(total) as avg_tokens from (
      select sum(input_tokens + output_tokens) as total from public.usage_costs group by user_id
    ) per_user
  ) avg_tok
  group by c.user_id, u.email, avg_tok.avg_tokens
  having avg_tok.avg_tokens > 0 and sum(c.input_tokens + c.output_tokens) > 3 * avg_tok.avg_tokens

  order by severity, detected_at desc;
$$;

revoke all on function public.admin_abuse_flags() from public, anon, authenticated;
grant execute on function public.admin_abuse_flags() to service_role;

-- ============================================================================
-- Data integrity checks. Same "surface, don't auto-fix" posture.
-- ============================================================================
create function public.admin_data_integrity_checks()
returns table (
  severity text,
  check_name text,
  user_id uuid,
  email text,
  message text
)
language sql
security definer
set search_path = public
as $$
  -- Every auth.users row should have exactly one entitlements row (the
  -- handle_new_user_entitlement trigger guarantees this for new signups,
  -- but older/manually-created accounts might predate it).
  select 'RED', 'missing_entitlement', u.id, u.email::text,
    'User has no entitlements row -- every edge function call for this user will 403'
  from auth.users u
  left join public.entitlements e on e.user_id = u.id
  where e.user_id is null

  union all

  -- A paid plan_id with no purchases or subscription backing it at all is
  -- suspicious (either a manual admin edit, or a purchase that never made
  -- it into public.purchases/subscriptions).
  select 'YELLOW', 'paid_plan_without_purchase_record', e.user_id, u.email::text,
    format('Plan is "%s" but there is no purchases or subscriptions row for this user', e.plan_id)
  from public.entitlements e
  join auth.users u on u.id = e.user_id
  where e.plan_id <> 'free'
    and not exists (select 1 from public.purchases p where p.user_id = e.user_id)
    and not exists (select 1 from public.subscriptions s where s.user_id = e.user_id)

  union all

  -- More than one subscriptions row per user should be impossible after
  -- 0014's unique constraint on subscriptions.user_id -- flagged anyway in
  -- case that constraint is ever dropped by mistake.
  select 'RED', 'duplicate_subscriptions', s.user_id, u.email::text,
    format('%s subscriptions rows for this user (expected at most 1)', count(*))
  from public.subscriptions s
  join auth.users u on u.id = s.user_id
  group by s.user_id, u.email
  having count(*) > 1

  union all

  -- A completed/expired session with no minutes_consumed recorded means the
  -- entitlement decrement for it can never have happened correctly.
  select 'YELLOW', 'session_missing_duration', s.user_id, u.email::text,
    format('Session %s is "%s" but has no minutes_consumed recorded', s.id, s.status)
  from public.interview_sessions s
  join auth.users u on u.id = s.user_id
  where s.status in ('completed', 'expired') and s.minutes_consumed is null

  union all

  -- entitlement_ledger should always sum to the live balance -- this is the
  -- same reconciliation check 0016's backfill self-verified against.
  select 'RED', 'ledger_balance_mismatch', e.user_id, u.email::text,
    format('Ledger sums to %s but live balance is %s', coalesce(t.running_total, 0), e.remaining_minutes)
  from public.entitlements e
  join auth.users u on u.id = e.user_id
  left join (
    select user_id, sum(delta) as running_total from public.entitlement_ledger group by user_id
  ) t on t.user_id = e.user_id
  where e.remaining_minutes <> coalesce(t.running_total, 0);
$$;

revoke all on function public.admin_data_integrity_checks() from public, anon, authenticated;
grant execute on function public.admin_data_integrity_checks() to service_role;

-- ============================================================================
-- AI usage analytics
-- ============================================================================
create function public.admin_ai_usage_summary()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'tokensToday', (select coalesce(sum(input_tokens + output_tokens), 0) from public.usage_costs where created_at >= date_trunc('day', now())),
    'tokensThisWeek', (select coalesce(sum(input_tokens + output_tokens), 0) from public.usage_costs where created_at >= date_trunc('week', now())),
    'tokensThisMonth', (select coalesce(sum(input_tokens + output_tokens), 0) from public.usage_costs where created_at >= date_trunc('month', now())),
    'estimatedCostUsd', (select coalesce(sum(estimated_cost_usd), 0) from public.usage_costs),
    'byModel', (
      select coalesce(jsonb_agg(row), '[]'::jsonb) from (
        select jsonb_build_object(
          'model', model, 'provider', provider, 'calls', count(*),
          'totalTokens', sum(input_tokens + output_tokens),
          'estimatedCostUsd', coalesce(sum(estimated_cost_usd), 0)
        ) as row
        from public.usage_costs group by model, provider order by sum(input_tokens + output_tokens) desc
      ) m
    ),
    'byUser', (
      select coalesce(jsonb_agg(row), '[]'::jsonb) from (
        select jsonb_build_object(
          'userId', c.user_id, 'email', u.email, 'calls', count(*),
          'totalTokens', sum(c.input_tokens + c.output_tokens),
          'estimatedCostUsd', coalesce(sum(c.estimated_cost_usd), 0)
        ) as row
        from public.usage_costs c
        join auth.users u on u.id = c.user_id
        group by c.user_id, u.email
        order by sum(c.input_tokens + c.output_tokens) desc
        limit 50
      ) m
    )
  );
$$;

revoke all on function public.admin_ai_usage_summary() from public, anon, authenticated;
grant execute on function public.admin_ai_usage_summary() to service_role;
