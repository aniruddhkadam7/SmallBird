-- Sweeps interview_sessions that went stale (app crashed, network dropped)
-- without ever calling usage-report or session-heartbeat recently, so they
-- don't permanently occupy the one-active-session-per-user slot.
-- Requires the pg_cron extension (enable it under Database -> Extensions
-- in the dashboard before applying this migration).

create extension if not exists pg_cron;

create or replace function public.expire_stale_interview_sessions()
returns void as $$
begin
  update public.interview_sessions
  set status = 'expired',
      ended_at = now(),
      termination_reason = 'stale_heartbeat',
      actual_duration_seconds = extract(epoch from (last_heartbeat_at - started_at))::int,
      minutes_consumed = extract(epoch from (last_heartbeat_at - started_at)) / 60.0
  where status = 'active'
    and last_heartbeat_at < now() - interval '2 minutes';
end;
$$ language plpgsql security definer set search_path = public;

select cron.schedule(
  'expire-stale-interview-sessions',
  '* * * * *', -- every minute
  $$select public.expire_stale_interview_sessions();$$
);
