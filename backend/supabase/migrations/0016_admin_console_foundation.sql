-- Admin console foundation: an allowlist-gated admin role, an audit log for
-- every administrative action, and an immutable ledger explaining every
-- entitlement balance change (past and future). None of these are reachable
-- by a normal signed-in user under any circumstances -- see the RLS/grant
-- notes on each object below. This mirrors the lockdown already applied to
-- increment_entitlement_minutes/decrement_entitlement_minutes in
-- 0014_lock_down_entitlement_rpcs.sql: SECURITY DEFINER functions with
-- EXECUTE revoked from anon/authenticated and granted only to service_role,
-- which only ever runs inside a Supabase Edge Function, never a browser.

-- ============================================================================
-- Admin allowlist
-- ============================================================================
create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

-- RLS enabled with zero policies -- unreachable via PostgREST/anon/
-- authenticated regardless of what key a client holds. Only a service-role
-- client (used exclusively inside admin Edge Functions) can ever read this.
alter table public.admin_users enable row level security;

-- ============================================================================
-- Audit log -- every administrative action, mutating or not
-- ============================================================================
create table public.admin_audit_logs (
  id bigint generated always as identity primary key,
  admin_user_id uuid not null references auth.users(id),
  admin_email text not null,
  action text not null,
  target_user_id uuid references auth.users(id),
  previous_value jsonb,
  new_value jsonb,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_audit_logs enable row level security;
-- Same lockdown as admin_users: zero client policies.

create index admin_audit_logs_target_user_id_idx on public.admin_audit_logs (target_user_id, created_at desc);
create index admin_audit_logs_admin_user_id_idx on public.admin_audit_logs (admin_user_id, created_at desc);

-- ============================================================================
-- Entitlement ledger -- append-only history of every balance change
-- ============================================================================
create table public.entitlement_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta numeric not null,
  balance_before numeric not null,
  balance_after numeric not null,
  source text not null check (source in
    ('SIGNUP_GRANT', 'PURCHASE', 'USAGE', 'ADMIN_GRANT', 'ADMIN_CORRECTION', 'REFUND_ADJUSTMENT')),
  reference_id text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.entitlement_ledger enable row level security;

create index entitlement_ledger_user_id_idx on public.entitlement_ledger (user_id, created_at);

-- Customers can already see their current balance (entitlements_select_own);
-- letting them see *why* it changed is a strict improvement and costs
-- nothing extra. Inserts remain service-role only -- no insert policy here.
create policy "entitlement_ledger_select_own"
  on public.entitlement_ledger for select
  using (auth.uid() = user_id);

-- ============================================================================
-- Wire the ledger into the existing purchase/usage RPCs
-- ============================================================================
-- Both functions are recreated (not just CREATE OR REPLACE) because we're
-- appending new parameters -- Postgres requires matching the existing
-- signature for REPLACE. Existing callers (razorpay-webhook, usage-report)
-- call these by named JSON args via PostgREST, so omitting the new
-- p_source/p_reference_id args continues to work unchanged; both default to
-- the same source these functions have always implicitly meant.
drop function if exists public.increment_entitlement_minutes(uuid, numeric);

create function public.increment_entitlement_minutes(
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
      updated_at = now()
  where user_id = p_user_id;

  insert into public.entitlement_ledger (user_id, delta, balance_before, balance_after, source, reference_id)
  values (p_user_id, p_minutes, v_before, v_after, p_source, p_reference_id);
end;
$$;

revoke all on function public.increment_entitlement_minutes(uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function public.increment_entitlement_minutes(uuid, numeric, text, text) to service_role;

drop function if exists public.decrement_entitlement_minutes(uuid, numeric);

create function public.decrement_entitlement_minutes(
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
begin
  select remaining_minutes into v_before from public.entitlements where user_id = p_user_id for update;
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

revoke all on function public.decrement_entitlement_minutes(uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function public.decrement_entitlement_minutes(uuid, numeric, text, text) to service_role;

-- ============================================================================
-- Log the free-tier signup grant too, so the ledger has a starting point
-- ============================================================================
create or replace function public.handle_new_user_entitlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minutes numeric;
begin
  select included_minutes into v_minutes from public.plans where id = 'free';

  insert into public.entitlements (user_id, plan_id, remaining_minutes)
  values (new.id, 'free', v_minutes)
  on conflict (user_id) do nothing;

  if found then
    insert into public.entitlement_ledger (user_id, delta, balance_before, balance_after, source)
    values (new.id, v_minutes, 0, v_minutes, 'SIGNUP_GRANT');
  end if;

  return new;
end;
$$;

-- ============================================================================
-- Admin minute adjustment -- the ONLY way an admin can change a balance.
-- Mutation + ledger row + audit row happen inside one transaction, so it is
-- structurally impossible to change a balance without leaving both an audit
-- trail and a ledger entry explaining it.
-- ============================================================================
create function public.admin_adjust_entitlement(
  p_admin_user_id uuid,
  p_admin_email text,
  p_target_user_id uuid,
  p_delta numeric,
  p_source text,
  p_reason text,
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
  v_action text;
  v_ledger_id bigint;
begin
  if p_source not in ('ADMIN_GRANT', 'ADMIN_CORRECTION') then
    raise exception 'invalid source for admin adjustment: %', p_source;
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required for admin entitlement adjustments';
  end if;

  select remaining_minutes into v_before from public.entitlements where user_id = p_target_user_id for update;
  if not found then
    raise exception 'no entitlement row for user %', p_target_user_id;
  end if;

  v_after := greatest(v_before + p_delta, 0);

  update public.entitlements
  set remaining_minutes = v_after,
      updated_at = now()
  where user_id = p_target_user_id;

  insert into public.entitlement_ledger (user_id, delta, balance_before, balance_after, source, reason, metadata)
  values (p_target_user_id, v_after - v_before, v_before, v_after, p_source, p_reason,
          jsonb_build_object('admin_user_id', p_admin_user_id, 'admin_email', p_admin_email))
  returning id into v_ledger_id;

  v_action := case when p_delta >= 0 then 'GRANT_MINUTES' else 'REMOVE_MINUTES' end;

  insert into public.admin_audit_logs
    (admin_user_id, admin_email, action, target_user_id, previous_value, new_value, reason, metadata)
  values (
    p_admin_user_id, p_admin_email, v_action, p_target_user_id,
    jsonb_build_object('remaining_minutes', v_before),
    jsonb_build_object('remaining_minutes', v_after),
    p_reason,
    jsonb_build_object('delta_requested', p_delta, 'delta_applied', v_after - v_before,
                        'ledger_id', v_ledger_id, 'ip', p_ip, 'user_agent', p_user_agent)
  );

  return v_after;
end;
$$;

revoke all on function public.admin_adjust_entitlement(uuid, text, uuid, numeric, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_adjust_entitlement(uuid, text, uuid, numeric, text, text, text, text) to service_role;

-- ============================================================================
-- One-time backfill: best-effort historical ledger rows for existing users,
-- reconstructed from purchases + historical session usage + the free-tier
-- signup grant, with a running balance. A final ADMIN_CORRECTION row per
-- user reconciles any residual gap to their actual current remaining_minutes
-- (this covers, among other things, the manual free-tier reset performed
-- 2026-09-09 to clean up the entitlement-RPC exploit) so the ledger always
-- sums to the live balance and nothing is left unexplained.
-- ============================================================================
with events as (
  select e.user_id,
         (select included_minutes from public.plans where id = 'free') as delta,
         'SIGNUP_GRANT' as source,
         null::text as reference_id,
         'Backfilled: free-tier signup grant' as reason,
         e.period_start as created_at
  from public.entitlements e

  union all

  select pu.user_id, pl.included_minutes, 'PURCHASE', pu.razorpay_order_id,
         'Backfilled: ' || pl.display_name || ' purchase', pu.created_at
  from public.purchases pu
  join public.plans pl on pl.id = pu.plan_id

  union all

  select s.user_id, -s.minutes_consumed, 'USAGE', s.id::text,
         'Backfilled: interview session usage', s.ended_at
  from public.interview_sessions s
  where s.status in ('completed', 'expired', 'terminated')
    and s.minutes_consumed is not null
    and s.minutes_consumed > 0
),
ordered as (
  select *,
         coalesce(sum(delta) over (
           partition by user_id order by created_at
           rows between unbounded preceding and 1 preceding
         ), 0) as balance_before,
         sum(delta) over (
           partition by user_id order by created_at
           rows between unbounded preceding and current row
         ) as balance_after
  from events
)
insert into public.entitlement_ledger
  (user_id, delta, balance_before, balance_after, source, reference_id, reason, created_at)
select user_id, delta, balance_before, balance_after, source, reference_id, reason, created_at
from ordered
order by user_id, created_at;

insert into public.entitlement_ledger
  (user_id, delta, balance_before, balance_after, source, reference_id, reason, created_at)
select
  e.user_id,
  e.remaining_minutes - coalesce(t.running_total, 0),
  coalesce(t.running_total, 0),
  e.remaining_minutes,
  'ADMIN_CORRECTION',
  null,
  'Backfilled reconciliation to current balance (includes the 2026-09-09 free-tier reset performed to clean up the entitlement-RPC exploit, where applicable)',
  now()
from public.entitlements e
left join (
  select user_id, sum(delta) as running_total
  from public.entitlement_ledger
  group by user_id
) t on t.user_id = e.user_id
where e.remaining_minutes <> coalesce(t.running_total, 0);
