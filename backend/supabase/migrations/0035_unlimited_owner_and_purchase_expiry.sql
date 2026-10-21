-- 1. Unlimited accounts (the owner). An unlimited row never expires and is
--    never charged: the trigger keeps period_end cleared even if an admin
--    later grants it a time-boxed pass, and decrement is a no-op for it.
--
-- 2. Paid minutes no longer die with an old pass. A one-time purchase used to
--    only add minutes, leaving any earlier admin-pass period_end in place, so
--    once that date passed requireEntitlement() refused the user with "plan
--    expired" even though they still had minutes they'd paid for. A PURCHASE
--    now clears period_end (the subscription renewal path in razorpay-webhook
--    sets its own period_end right after the increment, so it is unaffected).
--
-- 3. admin_grant_pass() logged previous period_end as a hard-coded null, which
--    hid the stale expiry when investigating; it now logs the real value.

alter table public.entitlements
  add column if not exists is_unlimited boolean not null default false;

create or replace function public.entitlements_enforce_unlimited()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_unlimited then
    new.period_end := null;
  end if;
  return new;
end;
$$;

drop trigger if exists entitlements_enforce_unlimited on public.entitlements;
create trigger entitlements_enforce_unlimited
  before insert or update on public.entitlements
  for each row execute function public.entitlements_enforce_unlimited();

create or replace function public.decrement_entitlement_minutes(
  p_user_id uuid,
  p_minutes numeric,
  p_source text default 'USAGE',
  p_reference_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before numeric;
  v_after numeric;
  v_unlimited boolean;
begin
  select remaining_minutes, is_unlimited into v_before, v_unlimited
  from public.entitlements where user_id = p_user_id for update;
  if v_unlimited then
    return;
  end if;
  v_after := greatest(v_before - p_minutes, 0);

  update public.entitlements
  set remaining_minutes = v_after,
      updated_at = now()
  where user_id = p_user_id;

  -- Records the delta actually applied (which may be less than -p_minutes if
  -- clamped at zero), not the requested amount, so the ledger always sums to
  -- the real balance.
  insert into public.entitlement_ledger (user_id, delta, balance_before, balance_after, source, reference_id)
  values (p_user_id, v_after - v_before, v_before, v_after, p_source, p_reference_id);
end;
$$;

create or replace function public.increment_entitlement_minutes(
  p_user_id uuid,
  p_minutes numeric,
  p_source text default 'PURCHASE',
  p_reference_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before numeric;
  v_after numeric;
begin
  select remaining_minutes into v_before from public.entitlements where user_id = p_user_id for update;
  v_after := v_before + p_minutes;

  update public.entitlements
  set remaining_minutes = v_after,
      period_end = case when p_source = 'PURCHASE' then null else period_end end,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.entitlement_ledger (user_id, delta, balance_before, balance_after, source, reference_id)
  values (p_user_id, p_minutes, v_before, v_after, p_source, p_reference_id);
end;
$$;

revoke all on function public.decrement_entitlement_minutes(uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function public.decrement_entitlement_minutes(uuid, numeric, text, text) to service_role;
revoke all on function public.increment_entitlement_minutes(uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function public.increment_entitlement_minutes(uuid, numeric, text, text) to service_role;

create or replace function public.admin_grant_pass(
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
  v_before_period_end timestamptz;
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

  select remaining_minutes, period_end into v_before, v_before_period_end
  from public.entitlements where user_id = p_target_user_id for update;
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
    jsonb_build_object('remaining_minutes', v_before, 'period_end', v_before_period_end),
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

-- The owner: unlimited, no expiry. The balance is set high so every client
-- "minutes left > 0" check passes; decrement never lowers it.
update public.entitlements
set is_unlimited = true,
    remaining_minutes = greatest(remaining_minutes, 99999),
    updated_at = now()
where user_id = (select id from auth.users where email = 'theaniruddhkadam@gmail.com');
