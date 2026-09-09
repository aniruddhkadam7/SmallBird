-- Phase 3b admin read/write functions: Subscriptions view, Pass/Access
-- grants, System Health signals. Same lockdown pattern as prior admin
-- migrations.

-- ============================================================================
-- Subscriptions -- dedicated view (Payments traces individual charges;
-- this shows the current subscription record per user).
-- ============================================================================
create function public.admin_list_subscriptions(
  p_search text default null,
  p_status text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  subscription_id uuid,
  user_id uuid,
  email text,
  plan text,
  status text,
  current_period_end timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language sql
security definer
set search_path = public
as $$
  with base as (
    select s.id as subscription_id, s.user_id, u.email::text as email, s.plan, s.status,
           s.current_period_end, s.created_at, s.updated_at
    from public.subscriptions s
    join auth.users u on u.id = s.user_id
  ),
  filtered as (
    select * from base
    where (p_search is null or p_search = '' or email ilike '%' || p_search || '%')
      and (p_status is null or status = p_status)
  )
  select *, count(*) over () as total_count
  from filtered
  order by created_at desc
  limit p_limit offset p_offset;
$$;

revoke all on function public.admin_list_subscriptions(text, text, int, int) from public, anon, authenticated;
grant execute on function public.admin_list_subscriptions(text, text, int, int) to service_role;

-- ============================================================================
-- Pass / Access grants -- a controlled, audited way to hand out free trial
-- time, bonus minutes, or promotional/extended access with a defined
-- expiration, distinct from a plain balance correction
-- (admin_adjust_entitlement) so the audit trail says "GRANT_PASS" and
-- records the expiration/note explicitly rather than folding it into a
-- generic reason string.
-- ============================================================================
create function public.admin_grant_pass(
  p_admin_user_id uuid,
  p_admin_email text,
  p_target_user_id uuid,
  p_minutes numeric,
  p_start_at timestamptz,
  p_expires_at timestamptz,
  p_reason text,
  p_note text default null,
  p_ip text default null,
  p_user_agent text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before numeric;
  v_after numeric;
  v_ledger_id bigint;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required for pass grants';
  end if;
  if p_minutes < 0 then
    raise exception 'minutes must be non-negative';
  end if;
  if p_expires_at is not null and p_expires_at <= p_start_at then
    raise exception 'expiration must be after the start date';
  end if;

  select remaining_minutes into v_before from public.entitlements where user_id = p_target_user_id for update;
  if not found then
    raise exception 'no entitlement row for user %', p_target_user_id;
  end if;

  v_after := v_before + p_minutes;

  update public.entitlements
  set remaining_minutes = v_after,
      period_start = coalesce(p_start_at, period_start),
      period_end = p_expires_at,
      updated_at = now()
  where user_id = p_target_user_id;

  insert into public.entitlement_ledger (user_id, delta, balance_before, balance_after, source, reason, metadata)
  values (p_target_user_id, p_minutes, v_before, v_after, 'ADMIN_GRANT', p_reason,
          jsonb_build_object(
            'kind', 'PASS',
            'admin_user_id', p_admin_user_id, 'admin_email', p_admin_email,
            'start_at', p_start_at, 'expires_at', p_expires_at, 'note', p_note
          ))
  returning id into v_ledger_id;

  insert into public.admin_audit_logs
    (admin_user_id, admin_email, action, target_user_id, previous_value, new_value, reason, metadata)
  values (
    p_admin_user_id, p_admin_email, 'GRANT_PASS', p_target_user_id,
    jsonb_build_object('remaining_minutes', v_before, 'period_end', null),
    jsonb_build_object('remaining_minutes', v_after, 'period_end', p_expires_at),
    p_reason,
    jsonb_build_object('minutes', p_minutes, 'start_at', p_start_at, 'expires_at', p_expires_at,
                        'note', p_note, 'ledger_id', v_ledger_id, 'ip', p_ip, 'user_agent', p_user_agent)
  );

  return v_after;
end;
$$;

revoke all on function public.admin_grant_pass(uuid, text, uuid, numeric, timestamptz, timestamptz, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_grant_pass(uuid, text, uuid, numeric, timestamptz, timestamptz, text, text, text, text) to service_role;

-- ============================================================================
-- System health -- built from signals we actually have in the schema today
-- (no error-log table exists yet, so this reports derived operational
-- signals rather than raw exceptions -- see admin-system-health's comment
-- for what a deeper integration would add).
-- ============================================================================
create function public.admin_system_health()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'sessionsStuckActive', (
      select count(*) from public.interview_sessions
      where status = 'active' and started_at < now() - interval '10 minutes'
    ),
    'failedSessions24h', (
      select count(*) from public.interview_sessions
      where status in ('terminated', 'expired') and started_at > now() - interval '24 hours'
    ),
    'failedSessions7d', (
      select count(*) from public.interview_sessions
      where status in ('terminated', 'expired') and started_at > now() - interval '7 days'
    ),
    'webhookEventsLast24h', (
      select count(*) from public.webhook_events where created_at > now() - interval '24 hours'
    ),
    'lastWebhookEventAt', (select max(created_at) from public.webhook_events),
    'lastEntitlementLedgerWriteAt', (select max(created_at) from public.entitlement_ledger),
    'lastInterviewSessionAt', (select max(started_at) from public.interview_sessions),
    'sessionsMissingDuration7d', (
      select count(*) from public.interview_sessions
      where status in ('completed', 'expired') and minutes_consumed is null
        and started_at > now() - interval '7 days'
    )
  );
$$;

revoke all on function public.admin_system_health() from public, anon, authenticated;
grant execute on function public.admin_system_health() to service_role;
