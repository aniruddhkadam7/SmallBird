-- A transcript is only saved once a question gets an answer, so a session
-- where nothing was asked (a Test Audio run, or opening and closing the
-- overlay) never has one -- and the admin console showed every one of those
-- as "Missing". Both session lists now carry ai_answers (AI answers given
-- during the session), so the console can show "No questions" for those and
-- keep "Missing" for sessions that were answered but whose transcript never
-- arrived.

drop function public.admin_list_sessions(text, text, timestamptz, timestamptz, boolean, int, int);

create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.jsonb_build_object from (
    select jsonb_build_object(
      'profile', (
        select jsonb_build_object(
          'userId', u.id, 'email', u.email, 'displayName', pr.display_name,
          'createdAt', u.created_at, 'lastSignInAt', u.last_sign_in_at,
          'signUpProvider', u.raw_app_meta_data->>'provider',
          'isOwner', exists (select 1 from public.admin_users a where a.user_id = u.id),
          'isBanned', coalesce(pr.is_banned, false),
          'banReason', pr.ban_reason,
          'bannedAt', pr.banned_at,
          'bannedByEmail', pr.banned_by_email
        )
        from auth.users u left join public.profiles pr on pr.id = u.id where u.id = p_user_id
      ),
      'devices', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'kind', d.client_kind, 'os', d.os, 'appVersion', d.app_version, 'userAgent', d.user_agent,
          'lastIp', d.last_ip, 'firstSeenAt', d.first_seen_at, 'lastSeenAt', d.last_seen_at,
          'signInCount', d.sign_in_count, 'sessionCount', d.session_count
        ) order by d.last_seen_at desc), '[]'::jsonb)
        from public.user_devices d where d.user_id = p_user_id
      ),
      'entitlement', (
        select jsonb_build_object('planId', plan_id, 'remainingMinutes', remaining_minutes, 'periodStart', period_start, 'periodEnd', period_end, 'updatedAt', updated_at)
        from public.entitlements where user_id = p_user_id
      ),
      'ledger', (
        select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc), '[]'::jsonb)
        from public.entitlement_ledger l where l.user_id = p_user_id
      ),
      'purchases', (
        select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc), '[]'::jsonb)
        from public.purchases p where p.user_id = p_user_id
      ),
      'subscriptions', (
        select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.subscriptions s where s.user_id = p_user_id
      ),
      'sessionsSummary', (
        select jsonb_build_object(
          'total', count(*), 'totalMinutesConsumed', coalesce(sum(minutes_consumed), 0),
          'completed', count(*) filter (where status = 'completed'),
          'terminated', count(*) filter (where status = 'terminated'),
          'expired', count(*) filter (where status = 'expired'),
          'active', count(*) filter (where status = 'active')
        )
        from public.interview_sessions where user_id = p_user_id
      ),
      'sessions', (
        select coalesce(jsonb_agg(to_jsonb(s2) order by s2.started_at desc), '[]'::jsonb) from (
          select s.id, s.started_at, s.ended_at, s.status, s.minutes_consumed, s.actual_duration_seconds,
                 s.usage_deducted, s.termination_reason, s.client_kind, s.client_os,
                 (select count(*) from public.usage_costs c where c.user_id = s.user_id
                   and c.created_at between s.started_at and coalesce(s.ended_at, s.started_at + interval '3 hours')) as ai_answers,
                 t.transcript_id, t.turn_count as transcript_turn_count
          from public.interview_sessions s
          left join lateral (
            select it.id as transcript_id, jsonb_array_length(coalesce(it.turns, '[]'::jsonb)) as turn_count
            from public.interview_transcripts it
            where it.user_id = s.user_id
              and to_timestamp(it.started_at_ms / 1000.0) >= s.started_at - interval '2 minutes'
              and to_timestamp(it.started_at_ms / 1000.0) <= coalesce(s.ended_at, s.started_at + interval '3 hours') + interval '2 minutes'
            order by abs(extract(epoch from (to_timestamp(it.started_at_ms / 1000.0) - s.started_at)))
            limit 1
          ) t on true
          where s.user_id = p_user_id
        ) s2
      ),
      'usageCostsSummary', (
        select jsonb_build_object(
          'totalInputTokens', coalesce(sum(input_tokens), 0), 'totalOutputTokens', coalesce(sum(output_tokens), 0),
          'totalCalls', count(*), 'estimatedCostUsd', coalesce(sum(estimated_cost_usd), 0)
        )
        from public.usage_costs where user_id = p_user_id
      ),
      'transcripts', (
        select coalesce(jsonb_agg(to_jsonb(t2) order by t2.created_at desc), '[]'::jsonb) from (
          select id, role, company, started_at_ms, ended_at_ms,
                 jsonb_array_length(coalesce(turns, '[]'::jsonb)) as turn_count, created_at
          from public.interview_transcripts where user_id = p_user_id
        ) t2
      ),
      'transcriptCount', (select count(*) from public.interview_transcripts where user_id = p_user_id)
    )
  ) f cross join _auth;
$$;

revoke all on function public.admin_user_detail(uuid) from public, anon, authenticated;
grant execute on function public.admin_user_detail(uuid) to authenticated, service_role;

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
  session_id uuid, user_id uuid, email text, plan_id text, started_at timestamptz, ended_at timestamptz, status text,
  termination_reason text, minutes_consumed numeric, actual_duration_seconds integer, authorized_max_duration_seconds integer,
  usage_deducted boolean, stt_mode text, cloud_stt_provider text, llm_calls bigint, is_suspicious boolean,
  transcript_id uuid, transcript_turn_count integer, ai_answers bigint, total_count bigint
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
        coalesce(s.termination_reason = 'force_ended_by_new_login', false)
          and not exists (select 1 from public.admin_users a where a.user_id = s.user_id) as is_suspicious,
        t.transcript_id, t.turn_count as transcript_turn_count,
        (select count(*) from public.usage_costs c where c.user_id = s.user_id
                   and c.created_at between s.started_at and coalesce(s.ended_at, s.started_at + interval '3 hours')) as ai_answers
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
