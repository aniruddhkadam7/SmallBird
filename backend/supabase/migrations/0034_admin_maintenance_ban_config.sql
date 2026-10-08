-- 0034: Admin maintenance mode, user banning, app settings, and API key management

-- ============================================================================
-- Profiles: ban columns
-- ============================================================================
alter table public.profiles
  add column if not exists is_banned boolean not null default false,
  add column if not exists ban_reason text,
  add column if not exists banned_at timestamptz,
  add column if not exists banned_by_email text;

-- ============================================================================
-- App settings: key-value store for operational config (service_role only)
-- ============================================================================
create table public.app_settings (
  key text primary key,
  value text not null,
  description text not null default '',
  updated_at timestamptz not null default now(),
  updated_by_email text
);

alter table public.app_settings enable row level security;
-- Zero policies: unreachable from any browser client.

insert into public.app_settings (key, value, description) values
  ('maintenance_mode', 'false', 'When true, all new session starts and LLM calls are blocked'),
  ('maintenance_message', 'SmallBird is currently under maintenance. Please check back shortly.', 'Message shown to users during maintenance')
on conflict (key) do nothing;

-- ============================================================================
-- API key store: admin-managed API key overrides (service_role only)
-- ============================================================================
create table public.api_key_store (
  key_name text primary key,
  key_value text,              -- null = use env secret fallback
  key_hint text,               -- "...last6" for display only
  label text not null,
  description text not null default '',
  updated_at timestamptz,
  updated_by_email text
);

alter table public.api_key_store enable row level security;
-- Zero policies: unreachable from any browser client.

insert into public.api_key_store (key_name, label, description) values
  ('deepgram', 'Deepgram API Key', 'Deepgram management key used by stt-token to mint short-lived session keys. Overrides DEEPGRAM_API_KEY env secret when set.'),
  ('openai', 'OpenAI API Key', 'OpenAI key used by llm-proxy for GPT requests. Overrides OPENAI_API_KEY env secret when set.'),
  ('anthropic', 'Anthropic API Key', 'Anthropic key used by llm-proxy for Claude requests. Overrides ANTHROPIC_API_KEY env secret when set.'),
  ('razorpay_key_id', 'Razorpay Key ID', 'Razorpay key ID used by razorpay-webhook. Overrides RAZORPAY_KEY_ID env secret when set.'),
  ('razorpay_key_secret', 'Razorpay Key Secret', 'Razorpay key secret used by razorpay-webhook. Overrides RAZORPAY_KEY_SECRET env secret when set.')
on conflict (key_name) do nothing;

-- ============================================================================
-- admin_ban_user / admin_unban_user
-- ============================================================================
create or replace function public.admin_ban_user(
  p_admin_user_id uuid,
  p_admin_email text,
  p_target_user_id uuid,
  p_reason text,
  p_ip text default null,
  p_user_agent text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set is_banned = true,
      ban_reason = p_reason,
      banned_at = now(),
      banned_by_email = p_admin_email
  where id = p_target_user_id;

  if not found then
    raise exception 'User profile not found';
  end if;

  insert into public.admin_audit_logs (
    admin_user_id, admin_email, action, target_user_id, reason, metadata
  ) values (
    p_admin_user_id, p_admin_email, 'BAN_USER', p_target_user_id, p_reason,
    jsonb_build_object('ip', p_ip, 'user_agent', p_user_agent)
  );
end;
$$;

revoke all on function public.admin_ban_user(uuid, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_ban_user(uuid, text, uuid, text, text, text) to service_role;

create or replace function public.admin_unban_user(
  p_admin_user_id uuid,
  p_admin_email text,
  p_target_user_id uuid,
  p_reason text,
  p_ip text default null,
  p_user_agent text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set is_banned = false,
      ban_reason = null,
      banned_at = null,
      banned_by_email = null
  where id = p_target_user_id;

  if not found then
    raise exception 'User profile not found';
  end if;

  insert into public.admin_audit_logs (
    admin_user_id, admin_email, action, target_user_id, reason, metadata
  ) values (
    p_admin_user_id, p_admin_email, 'UNBAN_USER', p_target_user_id, p_reason,
    jsonb_build_object('ip', p_ip, 'user_agent', p_user_agent)
  );
end;
$$;

revoke all on function public.admin_unban_user(uuid, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_unban_user(uuid, text, uuid, text, text, text) to service_role;

-- ============================================================================
-- admin_get_app_settings: returns all settings (admin-only via embedded check)
-- ============================================================================
create or replace function public.admin_get_app_settings()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select coalesce(
    jsonb_object_agg(
      s.key,
      jsonb_build_object(
        'value', s.value,
        'description', s.description,
        'updatedAt', s.updated_at,
        'updatedByEmail', s.updated_by_email
      )
    ),
    '{}'::jsonb
  )
  from public.app_settings s
  cross join _auth;
$$;

revoke all on function public.admin_get_app_settings() from public, anon, authenticated;
grant execute on function public.admin_get_app_settings() to authenticated, service_role;

-- ============================================================================
-- admin_set_app_setting: update a setting (mutating, takes explicit admin ids)
-- ============================================================================
create or replace function public.admin_set_app_setting(
  p_admin_user_id uuid,
  p_admin_email text,
  p_key text,
  p_value text,
  p_ip text default null,
  p_user_agent text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_value text;
begin
  select value into v_old_value from public.app_settings where key = p_key;
  if not found then
    raise exception 'Unknown setting key: %', p_key;
  end if;

  update public.app_settings
  set value = p_value,
      updated_at = now(),
      updated_by_email = p_admin_email
  where key = p_key;

  insert into public.admin_audit_logs (
    admin_user_id, admin_email, action, previous_value, new_value, reason, metadata
  ) values (
    p_admin_user_id, p_admin_email, 'SET_APP_SETTING',
    jsonb_build_object('key', p_key, 'value', v_old_value),
    jsonb_build_object('key', p_key, 'value', p_value),
    p_key,
    jsonb_build_object('ip', p_ip, 'user_agent', p_user_agent)
  );
end;
$$;

revoke all on function public.admin_set_app_setting(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_app_setting(uuid, text, text, text, text, text) to service_role;

-- ============================================================================
-- admin_get_api_keys: list key slots with masked values (admin-only)
-- ============================================================================
create or replace function public.admin_get_api_keys()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'keyName', k.key_name,
        'label', k.label,
        'description', k.description,
        'isSet', k.key_value is not null,
        'keyHint', k.key_hint,
        'updatedAt', k.updated_at,
        'updatedByEmail', k.updated_by_email
      )
      order by k.key_name
    ),
    '[]'::jsonb
  )
  from public.api_key_store k
  cross join _auth;
$$;

revoke all on function public.admin_get_api_keys() from public, anon, authenticated;
grant execute on function public.admin_get_api_keys() to authenticated, service_role;

-- ============================================================================
-- admin_set_api_key: store an API key override (mutating)
-- ============================================================================
create or replace function public.admin_set_api_key(
  p_admin_user_id uuid,
  p_admin_email text,
  p_key_name text,
  p_key_value text,
  p_ip text default null,
  p_user_agent text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hint text;
begin
  if not exists (select 1 from public.api_key_store where key_name = p_key_name) then
    raise exception 'Unknown key slot: %', p_key_name;
  end if;

  v_hint := case
    when length(p_key_value) > 6 then '...' || right(p_key_value, 6)
    else '••••••'
  end;

  update public.api_key_store
  set key_value = p_key_value,
      key_hint = v_hint,
      updated_at = now(),
      updated_by_email = p_admin_email
  where key_name = p_key_name;

  insert into public.admin_audit_logs (
    admin_user_id, admin_email, action, reason, metadata
  ) values (
    p_admin_user_id, p_admin_email, 'SET_API_KEY',
    p_key_name,
    jsonb_build_object('keyName', p_key_name, 'hint', v_hint, 'ip', p_ip, 'user_agent', p_user_agent)
  );
end;
$$;

revoke all on function public.admin_set_api_key(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_api_key(uuid, text, text, text, text, text) to service_role;

-- ============================================================================
-- admin_clear_api_key: remove a DB override (fall back to env secret)
-- ============================================================================
create or replace function public.admin_clear_api_key(
  p_admin_user_id uuid,
  p_admin_email text,
  p_key_name text,
  p_ip text default null,
  p_user_agent text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.api_key_store where key_name = p_key_name) then
    raise exception 'Unknown key slot: %', p_key_name;
  end if;

  update public.api_key_store
  set key_value = null,
      key_hint = null,
      updated_at = now(),
      updated_by_email = p_admin_email
  where key_name = p_key_name;

  insert into public.admin_audit_logs (
    admin_user_id, admin_email, action, reason, metadata
  ) values (
    p_admin_user_id, p_admin_email, 'CLEAR_API_KEY',
    p_key_name,
    jsonb_build_object('keyName', p_key_name, 'ip', p_ip, 'user_agent', p_user_agent)
  );
end;
$$;

revoke all on function public.admin_clear_api_key(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_clear_api_key(uuid, text, text, text, text) to service_role;

-- ============================================================================
-- get_app_setting: fast internal helper for backend Edge Functions
-- Not admin-gated: any Edge Function with a service_role key can call this.
-- ============================================================================
create or replace function public.get_app_setting(p_key text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select value from public.app_settings where key = p_key;
$$;

revoke all on function public.get_app_setting(text) from public, anon;
grant execute on function public.get_app_setting(text) to authenticated, service_role;

-- ============================================================================
-- get_api_key_override: fast internal helper to read a DB-stored key
-- Returns null when no override is set (caller falls back to env secret).
-- ============================================================================
create or replace function public.get_api_key_override(p_key_name text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select key_value from public.api_key_store where key_name = p_key_name;
$$;

revoke all on function public.get_api_key_override(text) from public, anon;
grant execute on function public.get_api_key_override(text) to authenticated, service_role;

-- ============================================================================
-- Update admin_user_detail to include ban status in profile object
-- (Copy of 0030 with ban fields added to the profile subquery)
-- ============================================================================
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
          'isBanned', coalesce(pr.is_banned, false),
          'banReason', pr.ban_reason,
          'bannedAt', pr.banned_at,
          'bannedByEmail', pr.banned_by_email
        )
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
