-- Phase 2 admin read functions: Sessions monitoring, Transcript viewer,
-- Payments investigation. Same lockdown pattern as 0017: SECURITY DEFINER,
-- service_role-only EXECUTE.

-- ============================================================================
-- Sessions
-- ============================================================================
create function public.admin_list_sessions(
  p_search text default null,
  p_status text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_suspicious_only boolean default false,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  session_id uuid,
  user_id uuid,
  email text,
  plan_id text,
  started_at timestamptz,
  ended_at timestamptz,
  status text,
  termination_reason text,
  minutes_consumed numeric,
  actual_duration_seconds int,
  authorized_max_duration_seconds int,
  usage_deducted boolean,
  stt_mode text,
  cloud_stt_provider text,
  llm_calls bigint,
  is_suspicious boolean,
  total_count bigint
)
language sql
security definer
set search_path = public
as $$
  with base as (
    select
      s.id as session_id,
      s.user_id,
      u.email::text as email,
      s.plan_id,
      s.started_at,
      s.ended_at,
      s.status,
      s.termination_reason,
      s.minutes_consumed,
      s.actual_duration_seconds,
      s.authorized_max_duration_seconds,
      s.usage_deducted,
      s.stt_mode,
      s.cloud_stt_provider,
      coalesce((select count(*) from public.usage_costs c where c.session_id = s.id), 0) as llm_calls,
      -- Evidence of concurrent-device usage: this session was cut short by a
      -- second login elsewhere, or itself force-ended an older active
      -- session (see stt-token/index.ts's `force` handling). coalesce()
      -- because termination_reason is null for most sessions and
      -- `null = 'x'` is null, not false, which would otherwise leak nulls
      -- into this boolean column instead of a clean true/false.
      coalesce(s.termination_reason = 'force_ended_by_new_login', false) as is_suspicious
    from public.interview_sessions s
    join auth.users u on u.id = s.user_id
  ),
  filtered as (
    select * from base
    where (p_search is null or p_search = '' or email ilike '%' || p_search || '%' or user_id::text = p_search)
      and (p_status is null or status = p_status)
      and (p_date_from is null or started_at >= p_date_from)
      and (p_date_to is null or started_at <= p_date_to)
      and (not p_suspicious_only or is_suspicious)
  )
  select *, count(*) over () as total_count
  from filtered
  order by started_at desc
  limit p_limit offset p_offset;
$$;

revoke all on function public.admin_list_sessions(text, text, timestamptz, timestamptz, boolean, int, int) from public, anon, authenticated;
grant execute on function public.admin_list_sessions(text, text, timestamptz, timestamptz, boolean, int, int) to service_role;

-- ============================================================================
-- Transcripts (read-only -- no admin delete endpoint exists at all; see
-- 0015_interview_transcripts_no_delete.sql, which already revoked DELETE
-- from anon/authenticated at the grant level, not just RLS)
-- ============================================================================
create function public.admin_list_transcripts(
  p_search text default null,
  p_user_id uuid default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  transcript_id uuid,
  user_id uuid,
  email text,
  role text,
  company text,
  started_at_ms bigint,
  ended_at_ms bigint,
  turn_count int,
  created_at timestamptz,
  total_count bigint
)
language sql
security definer
set search_path = public
as $$
  with base as (
    select
      t.id as transcript_id,
      t.user_id,
      u.email::text as email,
      t.role,
      t.company,
      t.started_at_ms,
      t.ended_at_ms,
      jsonb_array_length(coalesce(t.turns, '[]'::jsonb)) as turn_count,
      t.created_at
    from public.interview_transcripts t
    join auth.users u on u.id = t.user_id
  ),
  filtered as (
    select * from base
    where (p_search is null or p_search = '' or email ilike '%' || p_search || '%'
           or role ilike '%' || p_search || '%' or company ilike '%' || p_search || '%')
      and (p_user_id is null or user_id = p_user_id)
  )
  select *, count(*) over () as total_count
  from filtered
  order by created_at desc
  limit p_limit offset p_offset;
$$;

revoke all on function public.admin_list_transcripts(text, uuid, int, int) from public, anon, authenticated;
grant execute on function public.admin_list_transcripts(text, uuid, int, int) to service_role;

create function public.admin_transcript_detail(p_transcript_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', t.id,
    'userId', t.user_id,
    'email', u.email,
    'role', t.role,
    'company', t.company,
    'startedAtMs', t.started_at_ms,
    'endedAtMs', t.ended_at_ms,
    'turns', t.turns,
    'createdAt', t.created_at
  )
  from public.interview_transcripts t
  join auth.users u on u.id = t.user_id
  where t.id = p_transcript_id;
$$;

revoke all on function public.admin_transcript_detail(uuid) from public, anon, authenticated;
grant execute on function public.admin_transcript_detail(uuid) to service_role;

-- ============================================================================
-- Payments -- traces PURCHASE ledger entries (both one-time order.paid and
-- subscription.charged grants, since both call increment_entitlement_minutes
-- with source='PURCHASE') against webhook_events (did the webhook actually
-- record processing this entity?) and purchases (amount/plan, one-time only).
-- ============================================================================
create function public.admin_list_payments(
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  ledger_id bigint,
  user_id uuid,
  email text,
  minutes_granted numeric,
  reference_id text,
  created_at timestamptz,
  webhook_recorded boolean,
  amount_paise int,
  purchase_plan_id text,
  subscription_plan text,
  subscription_status text,
  total_count bigint
)
language sql
security definer
set search_path = public
as $$
  with base as (
    select
      l.id as ledger_id,
      l.user_id,
      u.email::text as email,
      l.delta as minutes_granted,
      l.reference_id,
      l.created_at,
      exists(select 1 from public.webhook_events w where w.entity_id = l.reference_id) as webhook_recorded,
      pu.amount_paise,
      pu.plan_id as purchase_plan_id,
      sub.plan as subscription_plan,
      sub.status as subscription_status
    from public.entitlement_ledger l
    join auth.users u on u.id = l.user_id
    left join public.purchases pu on pu.razorpay_order_id = l.reference_id
    left join public.subscriptions sub on sub.user_id = l.user_id
    where l.source = 'PURCHASE'
  ),
  filtered as (
    select * from base
    where (p_search is null or p_search = '' or email ilike '%' || p_search || '%' or reference_id ilike '%' || p_search || '%')
  )
  select *, count(*) over () as total_count
  from filtered
  order by created_at desc
  limit p_limit offset p_offset;
$$;

revoke all on function public.admin_list_payments(text, int, int) from public, anon, authenticated;
grant execute on function public.admin_list_payments(text, int, int) to service_role;
