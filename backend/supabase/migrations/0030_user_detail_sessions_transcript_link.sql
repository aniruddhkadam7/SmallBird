-- Same transcript-matching added to Sessions (0029) now added to the user
-- detail page's session list too, so the "Transcript" button per session
-- works there as well.
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
        select jsonb_build_object('userId', u.id, 'email', u.email, 'displayName', pr.display_name, 'createdAt', u.created_at, 'lastSignInAt', u.last_sign_in_at)
        from auth.users u left join public.profiles pr on pr.id = u.id where u.id = p_user_id
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
                 s.usage_deducted, s.termination_reason, t.transcript_id, t.turn_count as transcript_turn_count
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
