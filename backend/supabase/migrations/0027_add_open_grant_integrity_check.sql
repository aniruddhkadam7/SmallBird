-- Permanent safeguard against a repeat of the entitlement-RPC exploit: adds
-- a check to admin_data_integrity_checks() that flags any SECURITY DEFINER
-- function reachable by anon/authenticated that isn't on the explicit
-- known-safe allowlist below. SECURITY DEFINER functions bypass RLS by
-- design, so one left open to anon/authenticated by mistake (the exact
-- root cause of the entitlement-RPC exploit) is the highest-severity class
-- of bug this schema can have. This turns "nobody notices for months" into
-- "shows up on the Data Integrity page the next time anyone opens it."
--
-- Maintaining this allowlist is deliberate friction: adding a new
-- SECURITY DEFINER function that legitimately needs to be callable by
-- authenticated/anon means editing this list, which is the moment to
-- double-check the function actually enforces its own authorization
-- (like current_admin_user_id()/admin_* do) rather than trusting the caller.
--
-- Verified live: a deliberately-planted SECURITY DEFINER function with the
-- same shape as the original exploit (open to everyone, mutates a balance)
-- was caught immediately by this check before being dropped again.
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

    union all

    select 'RED', 'open_security_definer_function', null::uuid, null::text,
      format(
        'Function public.%s(%s) is SECURITY DEFINER and callable by %s -- this bypasses RLS. ' ||
        'If it mutates data, verify it enforces its own authorization (see current_admin_user_id() for the pattern) before adding it to this allowlist.',
        p.proname, pg_get_function_identity_arguments(p.oid),
        case
          when has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'anon and authenticated'
          when has_function_privilege('anon', p.oid, 'EXECUTE') then 'anon'
          else 'authenticated'
        end
      )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      and p.proname not in (
        'admin_whoami', 'current_admin_user_id', 'admin_abuse_flags', 'admin_ai_usage_summary',
        'admin_dashboard_stats', 'admin_data_integrity_checks', 'admin_list_all_admins',
        'admin_list_audit_logs', 'admin_list_payments', 'admin_list_sessions', 'admin_list_subscriptions',
        'admin_list_transcripts', 'admin_list_users', 'admin_system_health', 'admin_transcript_detail',
        'admin_user_detail'
      )
  ) f cross join _auth;
$$;

revoke all on function public.admin_data_integrity_checks() from public, anon, authenticated;
grant execute on function public.admin_data_integrity_checks() to authenticated, service_role;
