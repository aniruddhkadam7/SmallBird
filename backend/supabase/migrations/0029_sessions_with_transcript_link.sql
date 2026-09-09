-- interview_transcripts has no session_id column (client-generated, no FK to
-- interview_sessions) -- see history.rs's design. Best-effort match: same
-- user, transcript start time falls within the session's window (with a
-- little slack since the two are generated on different clocks/paths). A
-- user only ever has one active session at a time (unique partial index),
-- so sessions never overlap in time for the same user, making this
-- unambiguous in practice even without a real key to join on.
drop function public.admin_list_sessions(text, text, timestamptz, timestamptz, boolean, int, int);

create function public.admin_list_sessions(
  p_search text default null, p_status text default null, p_date_from timestamptz default null,
  p_date_to timestamptz default null, p_suspicious_only boolean default false, p_limit int default 50, p_offset int default 0
)
returns table (
  session_id uuid, user_id uuid, email text, plan_id text, started_at timestamptz, ended_at timestamptz,
  status text, termination_reason text, minutes_consumed numeric, actual_duration_seconds int,
  authorized_max_duration_seconds int, usage_deducted boolean, stt_mode text, cloud_stt_provider text,
  llm_calls bigint, is_suspicious boolean, transcript_id uuid, transcript_turn_count int, total_count bigint
)
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.* from (
    with base as (
      select
        s.id as session_id, s.user_id, u.email::text as email, s.plan_id, s.started_at, s.ended_at, s.status,
        s.termination_reason, s.minutes_consumed, s.actual_duration_seconds, s.authorized_max_duration_seconds,
        s.usage_deducted, s.stt_mode, s.cloud_stt_provider,
        coalesce((select count(*) from public.usage_costs c where c.session_id = s.id), 0) as llm_calls,
        coalesce(s.termination_reason = 'force_ended_by_new_login', false) as is_suspicious,
        t.transcript_id, t.turn_count as transcript_turn_count
      from public.interview_sessions s
      join auth.users u on u.id = s.user_id
      left join lateral (
        select it.id as transcript_id, jsonb_array_length(coalesce(it.turns, '[]'::jsonb)) as turn_count
        from public.interview_transcripts it
        where it.user_id = s.user_id
          and to_timestamp(it.started_at_ms / 1000.0) >= s.started_at - interval '2 minutes'
          and to_timestamp(it.started_at_ms / 1000.0) <= coalesce(s.ended_at, s.started_at + interval '3 hours') + interval '2 minutes'
        order by abs(extract(epoch from (to_timestamp(it.started_at_ms / 1000.0) - s.started_at)))
        limit 1
      ) t on true
    ),
    filtered as (
      select * from base
      where (p_search is null or p_search = '' or email ilike '%' || p_search || '%' or user_id::text = p_search)
        and (p_status is null or status = p_status)
        and (p_date_from is null or started_at >= p_date_from)
        and (p_date_to is null or started_at <= p_date_to)
        and (not p_suspicious_only or is_suspicious)
    )
    select *, count(*) over () as total_count from filtered order by started_at desc limit p_limit offset p_offset
  ) f cross join _auth;
$$;

revoke all on function public.admin_list_sessions(text, text, timestamptz, timestamptz, boolean, int, int) from public, anon, authenticated;
grant execute on function public.admin_list_sessions(text, text, timestamptz, timestamptz, boolean, int, int) to authenticated, service_role;
