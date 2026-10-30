-- Per-day details behind the AI usage page's OpenAI and Deepgram charts:
-- what happened on each UTC day (calls, people, interviews, minutes), not
-- just what it cost.

-- OpenAI side, from usage_costs. Admin-checked; read by admin-openai-balance.
create or replace function public.admin_usage_costs_daily(p_days int default 30)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select coalesce(jsonb_object_agg(t.day, jsonb_build_object(
    'calls', t.calls, 'users', t.users, 'interviews', t.interviews, 'tokens', t.tokens
  )), '{}'::jsonb)
  from _auth
  left join (
    select (created_at at time zone 'utc')::date as day,
           count(*) as calls,
           count(distinct user_id) as users,
           count(distinct session_id) as interviews,
           sum(input_tokens + output_tokens) as tokens
    from public.usage_costs
    where created_at >= now() - make_interval(days => p_days)
    group by 1
  ) t on true
  where t.day is not null;
$$;

revoke all on function public.admin_usage_costs_daily(int) from public, anon, authenticated;
grant execute on function public.admin_usage_costs_daily(int) to authenticated, service_role;

-- Deepgram side: deepgram_cost_summary's daily rows now also carry minutes
-- transcribed, interviews and people (via each interview's key).
create or replace function public.deepgram_cost_summary()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'todayUsd', (select coalesce(sum(usd), 0) from public.deepgram_request_costs
                 where created >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
    'thisMonthUsd', (select coalesce(sum(usd), 0) from public.deepgram_request_costs
                     where created >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'),
    'totalUsd', (select coalesce(sum(usd), 0) from public.deepgram_request_costs),
    -- Spend on keys that belong to an interview vs. anything else (keys
    -- from before 2026-09-26, or used outside stt-token).
    'interviewUsd', (select coalesce(sum(d.usd), 0) from public.deepgram_request_costs d
                     where exists (select 1 from public.interview_sessions s where s.deepgram_key_id = d.api_key_id)),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
                'date', t.day, 'usd', t.usd, 'minutes', t.minutes, 'requests', t.requests,
                'interviews', t.interviews, 'users', t.users
              ) order by t.day), '[]'::jsonb) from (
      select (d.created at time zone 'utc')::date as day,
             sum(d.usd) as usd,
             round(sum(d.duration_seconds) / 60.0, 1) as minutes,
             count(*) as requests,
             count(distinct s.id) as interviews,
             count(distinct s.user_id) as users
      from public.deepgram_request_costs d
      left join public.interview_sessions s on s.deepgram_key_id = d.api_key_id
      where d.created >= now() - interval '30 days'
      group by 1
    ) t)
  );
$$;

revoke all on function public.deepgram_cost_summary() from public, anon, authenticated;
grant execute on function public.deepgram_cost_summary() to service_role;
