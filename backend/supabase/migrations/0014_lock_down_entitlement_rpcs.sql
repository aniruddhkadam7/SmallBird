-- Root cause of the reported "0 -> 60 minutes reset with no purchase" bug:
-- increment_entitlement_minutes / decrement_entitlement_minutes are
-- SECURITY DEFINER functions that take p_user_id as a plain argument (not
-- derived from auth.uid()), and Postgres grants EXECUTE on new functions to
-- PUBLIC by default. Neither 0005_backend_rpc_functions.sql nor any later
-- migration ever revoked that. The result: any signed-in app user (or
-- anyone with the app's public anon key + a free account) could call
-- POST /rest/v1/rpc/increment_entitlement_minutes directly via PostgREST
-- with { p_user_id: "<their own id>", p_minutes: 60 } and refill their own
-- balance for free, any time, bypassing Razorpay entirely. This migration
-- restricts both RPCs to service_role only — the only place they're
-- actually supposed to be called from (razorpay-webhook, usage-report).

revoke execute on function public.increment_entitlement_minutes(uuid, numeric) from public, anon, authenticated;
revoke execute on function public.decrement_entitlement_minutes(uuid, numeric) from public, anon, authenticated;
grant execute on function public.increment_entitlement_minutes(uuid, numeric) to service_role;
grant execute on function public.decrement_entitlement_minutes(uuid, numeric) to service_role;

-- Idempotency guard for usage-report: without this, a session that no
-- longer matches `status = 'active'` (already completed/terminated, or a
-- retried request) silently updates zero rows while the entitlement
-- decrement still fires unconditionally, deducting minutes more than once
-- for the same sessionId.
alter table public.interview_sessions
  add column if not exists usage_deducted boolean not null default false;

-- subscriptions.user_id was never made unique, so every renewal webhook's
-- `upsert({ user_id, ... })` with no onConflict target inserted a brand new
-- row instead of updating the existing subscription, leaving duplicate/stale
-- rows per user. One active subscription row per user is the actual model.
delete from public.subscriptions a using public.subscriptions b
  where a.user_id = b.user_id and a.id < b.id;

alter table public.subscriptions
  add constraint subscriptions_user_id_key unique (user_id);
