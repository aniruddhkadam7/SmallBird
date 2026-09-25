-- Security hardening (Sept 2026 audit). Additive: new columns, a rate-limit
-- table, and SECURITY DEFINER helpers callable only by the service role.
--
-- Fixes:
--  * Billing is computed server-side (end_and_bill_session) instead of from
--    the client-reported duration, and sessions that end without a usage
--    report (crash / kill / offline -> expired) are now billed too.
--  * Each session's Deepgram key id is stored so it can be revoked once the
--    session has ended (by usage-report / stt-token / the session-janitor).
--  * Login codes: attempts are claimed atomically (parallel guesses can no
--    longer all see "0 attempts used"), with a per-email daily failure budget.
--  * A generic rate-limit table used by llm-proxy and the login functions.

-- ---- Deepgram key tracking ------------------------------------------------
alter table public.interview_sessions
  add column if not exists deepgram_key_id text,
  add column if not exists deepgram_key_revoked_at timestamptz;

create index if not exists interview_sessions_unrevoked_keys_idx
  on public.interview_sessions (ended_at)
  where deepgram_key_id is not null and deepgram_key_revoked_at is null and status <> 'active';

-- ---- Server-side billing -------------------------------------------------
-- Ends one of the caller's active sessions and bills it from the server's own
-- clock (start -> now, capped at what was authorized). Claims the row at most
-- once (status active + not yet deducted), so it can never double-bill.
-- Returns nothing when the session was already ended/billed.
create or replace function public.end_and_bill_session(
  p_session_id uuid,
  p_user_id uuid,
  p_status text,
  p_reason text default null
) returns table (deepgram_key_id text, minutes numeric)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_minutes numeric;
  v_key text;
begin
  if p_status not in ('completed', 'terminated') then
    raise exception 'invalid end status: %', p_status;
  end if;

  update public.interview_sessions s
     set status = p_status,
         termination_reason = coalesce(p_reason, s.termination_reason),
         ended_at = now(),
         actual_duration_seconds = least(extract(epoch from (now() - s.started_at)), s.authorized_max_duration_seconds)::int,
         minutes_consumed = greatest(least(extract(epoch from (now() - s.started_at)), s.authorized_max_duration_seconds), 0) / 60.0,
         usage_deducted = true
   where s.id = p_session_id
     and s.user_id = p_user_id
     and s.status = 'active'
     and s.usage_deducted = false
  returning s.id, s.minutes_consumed, s.deepgram_key_id into v_id, v_minutes, v_key;

  if v_id is null then
    return;
  end if;

  if v_minutes > 0 then
    perform public.decrement_entitlement_minutes(p_user_id, v_minutes, 'USAGE', p_session_id::text);
  end if;

  deepgram_key_id := v_key;
  minutes := v_minutes;
  return next;
end;
$$;

revoke all on function public.end_and_bill_session(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.end_and_bill_session(uuid, uuid, text, text) to service_role;

-- The stale-session sweeper (pg_cron, every minute) now also bills what it
-- expires: start -> last heartbeat, capped at the authorized duration. Before
-- this, a session whose app crashed, was killed, or went offline was never
-- deducted at all.
create or replace function public.expire_stale_interview_sessions()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
begin
  for r in
    update public.interview_sessions s
       set status = 'expired',
           ended_at = now(),
           termination_reason = 'stale_heartbeat',
           actual_duration_seconds = least(extract(epoch from (s.last_heartbeat_at - s.started_at)), s.authorized_max_duration_seconds)::int,
           minutes_consumed = greatest(least(extract(epoch from (s.last_heartbeat_at - s.started_at)), s.authorized_max_duration_seconds), 0) / 60.0,
           usage_deducted = true
     where s.status = 'active'
       and s.usage_deducted = false
       and s.last_heartbeat_at < now() - interval '2 minutes'
    returning s.id, s.user_id, s.minutes_consumed
  loop
    if r.minutes_consumed > 0 then
      perform public.decrement_entitlement_minutes(r.user_id, r.minutes_consumed, 'USAGE', r.id::text);
    end if;
  end loop;
end;
$$;

-- ---- Generic rate limiting -------------------------------------------------
create table if not exists public.rate_limit_hits (
  id bigserial primary key,
  bucket text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_limit_hits_bucket_created_idx on public.rate_limit_hits (bucket, created_at desc);
alter table public.rate_limit_hits enable row level security; -- no policies: service role only

-- Records one hit in `p_bucket` and returns whether it is within the limit
-- (at most p_limit hits in the last p_window_seconds, counting this one).
-- Serialized per bucket so parallel requests can't all slip under the limit.
create or replace function public.rate_limit_hit(p_bucket text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtext('rate:' || p_bucket));
  select count(*) into v_count
    from public.rate_limit_hits
   where bucket = p_bucket
     and created_at > now() - make_interval(secs => p_window_seconds);
  if v_count >= p_limit then
    return false;
  end if;
  insert into public.rate_limit_hits (bucket) values (p_bucket);
  return true;
end;
$$;

revoke all on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;

-- ---- Login codes: atomic attempt claiming ---------------------------------
alter table public.login_otps add column if not exists request_ip text;

-- Claims one verification attempt for the newest unconsumed, unexpired code
-- for this email and returns it (with the attempt already counted), or a
-- reason it can't be tried. All claims for one email are serialized, the
-- per-code limit is enforced inside the same UPDATE, and a daily failure
-- budget across all of that email's codes caps total guessing.
create or replace function public.otp_claim_attempt(p_email text, p_max_attempts int, p_daily_budget int)
returns table (otp_id uuid, code_hash text, status text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_used int;
  v_id uuid;
  v_hash text;
begin
  perform pg_advisory_xact_lock(hashtext('otp:' || p_email));

  select coalesce(sum(o.attempts), 0) into v_used
    from public.login_otps o
   where o.email = p_email
     and o.created_at > now() - interval '24 hours';
  if v_used >= p_daily_budget then
    otp_id := null; code_hash := null; status := 'locked';
    return next;
    return;
  end if;

  update public.login_otps o
     set attempts = o.attempts + 1
   where o.id = (
           select id from public.login_otps
            where email = p_email and consumed = false
            order by created_at desc
            limit 1
         )
     and o.consumed = false
     and o.expires_at > now()
     and o.attempts < p_max_attempts
  returning o.id, o.code_hash into v_id, v_hash;

  if v_id is null then
    otp_id := null; code_hash := null; status := 'unavailable';
  else
    otp_id := v_id; code_hash := v_hash; status := 'ok';
  end if;
  return next;
end;
$$;

revoke all on function public.otp_claim_attempt(text, int, int) from public, anon, authenticated;
grant execute on function public.otp_claim_attempt(text, int, int) to service_role;

-- Marks a code used exactly once (a second, parallel correct guess gets false).
create or replace function public.otp_consume(p_otp_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  update public.login_otps set consumed = true
   where id = p_otp_id and consumed = false
  returning id into v_id;
  return v_id is not null;
end;
$$;

revoke all on function public.otp_consume(uuid) from public, anon, authenticated;
grant execute on function public.otp_consume(uuid) to service_role;

-- ---- Housekeeping ------------------------------------------------------------
-- Rate-limit rows only matter for their window; keep a day for auditing.
select cron.schedule(
  'prune-rate-limit-hits',
  '17 * * * *',
  $$delete from public.rate_limit_hits where created_at < now() - interval '1 day'$$
);
