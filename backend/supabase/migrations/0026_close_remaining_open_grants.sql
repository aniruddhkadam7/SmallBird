-- Full-schema audit triggered by the entitlement-RPC exploit investigation:
-- checked every function in public for the same root-cause pattern (default
-- PUBLIC EXECUTE grant never revoked). Found two more, neither exploitable
-- for financial gain like increment/decrement_entitlement_minutes were, but
-- both are mutating and had no business being reachable by anon/
-- authenticated. Closing both for the same reason as 0014: a function
-- should never be more open than it needs to be, regardless of whether
-- today's code happens to make that harmless.

-- current_admin_user_id() was intentionally open to `authenticated` (any
-- signed-in user needs to be able to ask "am I an admin?"), but the default
-- PUBLIC grant also left it open to `anon` (unauthenticated requests using
-- just the public API key) for no reason -- auth.uid() is null for anon
-- either way so this was never actually exploitable, but there's no reason
-- to leave it open.
revoke execute on function public.current_admin_user_id() from anon;

-- expire_stale_interview_sessions() is called only by the pg_cron job in
-- 0006_session_expiry_sweep.sql (which runs as the job owner, unaffected by
-- this) -- it was never meant to be reachable by any client at all. It only
-- acts on sessions that are already stale (heartbeat >2 minutes old) and
-- takes no parameters, so this was low-severity, but a mutating,
-- unauthenticated, world-callable function is exactly the shape of bug this
-- migration exists to eliminate on sight.
revoke execute on function public.expire_stale_interview_sessions() from public, anon, authenticated;
grant execute on function public.expire_stale_interview_sessions() to service_role;
