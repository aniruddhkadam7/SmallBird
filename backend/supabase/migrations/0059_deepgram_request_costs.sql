-- Deepgram's real cost per request, cached for the admin console.
--
-- stt-token mints a Deepgram key per interview (interview_sessions.
-- deepgram_key_id, 0031), and Deepgram's request log reports each request's
-- api_key_id and its exact USD cost -- so an interview's speech-to-text cost
-- is the sum of its key's requests, no estimating. The admin-* functions
-- sync this table from /v1/projects/{id}/requests at most every 10 minutes
-- (_shared/deepgramCosts.ts) and read it from here.

create table if not exists public.deepgram_request_costs (
  request_id text primary key,
  api_key_id text,
  created timestamptz not null,
  usd numeric not null default 0,
  duration_seconds numeric not null default 0
);

create index if not exists deepgram_request_costs_key_idx on public.deepgram_request_costs (api_key_id);
create index if not exists deepgram_request_costs_created_idx on public.deepgram_request_costs (created);

alter table public.deepgram_request_costs enable row level security;
-- Zero policies: only the service role (edge functions) reads or writes it.

-- When each external cost source was last synced (e.g. 'deepgram').
create table if not exists public.external_cost_sync (
  source text primary key,
  synced_at timestamptz not null
);

alter table public.external_cost_sync enable row level security;

-- Deepgram cost per user and per interview, for admin-user-ai-costs.
create or replace function public.admin_user_deepgram_costs(p_user_ids uuid[])
returns jsonb
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', t.user_id, 'sessionId', t.id, 'usd', t.usd, 'seconds', t.seconds
  )), '[]'::jsonb)
  from _auth
  left join (
    select s.user_id, s.id, sum(d.usd) as usd, sum(d.duration_seconds) as seconds
    from public.interview_sessions s
    join public.deepgram_request_costs d on d.api_key_id = s.deepgram_key_id
    where s.user_id = any(p_user_ids)
    group by s.user_id, s.id
  ) t on true
  where t.id is not null;
$$;

revoke all on function public.admin_user_deepgram_costs(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_user_deepgram_costs(uuid[]) to authenticated, service_role;

-- Deepgram spend summary for admin-deepgram-usage (which has already checked
-- the caller is an admin, and calls this with the service role).
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
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('date', t.day, 'usd', t.usd) order by t.day), '[]'::jsonb) from (
      select (created at time zone 'utc')::date as day, sum(usd) as usd
      from public.deepgram_request_costs
      where created >= now() - interval '30 days'
      group by 1
    ) t)
  );
$$;

revoke all on function public.deepgram_cost_summary() from public, anon, authenticated;
grant execute on function public.deepgram_cost_summary() to service_role;
