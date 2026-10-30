-- Shows each user's phone number and the rest of what we know about them in
-- the admin console, without asking users for anything extra. Sign-up only
-- gives us an email (and the Google name and photo); the phone comes from
-- Razorpay -- every checkout asks the payer for their mobile number and
-- email, and razorpay-webhook now keeps them (payment_contacts below). For
-- users who never reached checkout, the phone, location and links come from
-- their CVs: the contact rows of their resume-builder CVs and any CV text
-- they uploaded. Needs 0050 and 0052. Desktop CVs are read from
-- interview_transcripts.context_docs (0051, which drops 0047's resume_text);
-- the column is added here too in case 0051 hasn't run yet.
alter table public.interview_transcripts
  add column if not exists context_docs jsonb not null default '[]'::jsonb;

-- One row per Razorpay payment, paid or failed (a failed one is still
-- someone who tried to buy), with what the payer typed at checkout.
-- Written only by razorpay-webhook with the service role; admin-only.
create table if not exists public.payment_contacts (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  razorpay_payment_id text not null unique,
  razorpay_order_id text,
  contact text,
  email text,
  method text,
  vpa text,
  bank text,
  wallet text,
  amount_paise integer,
  status text not null,
  created_at timestamptz not null default now()
);

create index if not exists payment_contacts_user_id_created_at_idx
  on public.payment_contacts (user_id, created_at desc);

alter table public.payment_contacts enable row level security;
revoke all on public.payment_contacts from public, anon, authenticated;

-- Until now any signed-in user could write every column of their own
-- profile row through PostgREST -- including is_banned, so a banned user
-- could unban themselves. No app writes profiles directly (bans go through
-- admin_ban_user), so only the harmless columns stay writable.
revoke insert, update on public.profiles from anon, authenticated;
revoke select on public.profiles from anon;
grant insert (id, display_name, avatar_url) on public.profiles to authenticated;
grant update (display_name, avatar_url, updated_at) on public.profiles to authenticated;

-- Everything we have on how to reach one user. Phones are deduplicated on
-- their last 10 digits (so "+91 98765 43210" and "9876543210" are one):
-- Razorpay's first (newest payment first), then the newest CV. Called only from the admin
-- functions below, which run as the owner.
create or replace function public.admin_user_contact(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  with entries as (
    select lower(trim(e->>'label')) as label, trim(e->>'value') as value, x.at
    from (select data, updated_at as at from public.resumes where user_id = p_user_id) x
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(x.data->'contact') = 'array' then x.data->'contact' else '[]'::jsonb end
    ) e
    where nullif(trim(e->>'value'), '') is not null
  ),
  texts as (
    select uploaded_text as txt, created_at as at
    from public.resume_ai_requests where user_id = p_user_id and nullif(uploaded_text, '') is not null
    union all
    select d->>'text', t.created_at from public.interview_transcripts t
    cross join lateral jsonb_array_elements(t.context_docs) d
    where t.user_id = p_user_id and d->>'docType' = 'RESUME' and nullif(d->>'text', '') is not null
  ),
  phones as (
    select contact as value, 'Razorpay' as source, created_at as at, 0 as rank
    from public.payment_contacts where user_id = p_user_id and nullif(contact, '') is not null
    union all
    select '+' || u.phone, 'Account', u.created_at, 0
    from auth.users u where u.id = p_user_id and nullif(u.phone, '') is not null
    union all
    select value, 'CV', at, 1 from entries where label ~ '(phone|mobile|tel|cell|whatsapp|contact)'
    union all
    select m[1], 'Uploaded CV', t.at, 2
    from texts t cross join lateral regexp_matches(t.txt, '\+?\d[\d \-().]{7,16}\d', 'g') m
    where length(regexp_replace(m[1], '\D', '', 'g')) between 10 and 13
  ),
  phones_unique as (
    select distinct on (right(regexp_replace(value, '\D', '', 'g'), 10)) value, source, rank, at
    from phones where length(regexp_replace(value, '\D', '', 'g')) >= 7
    order by right(regexp_replace(value, '\D', '', 'g'), 10), rank, at desc
  ),
  others as (
    select distinct on (lower(value)) label, value, at,
      case
        when label ~ '(location|address|city)' then 'location'
        when label ~ 'linkedin' or value ilike '%linkedin.com%' then 'linkedin'
        else 'link'
      end as kind
    from entries
    where label !~ '(phone|mobile|tel|cell|whatsapp|contact|e-?mail)'
    order by lower(value), at desc
  )
  select jsonb_build_object(
    'phones', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'source', source) order by rank, at desc) from phones_unique), '[]'::jsonb),
    'locations', coalesce((select jsonb_agg(value order by at desc) from others where kind = 'location'), '[]'::jsonb),
    'linkedin', coalesce((select jsonb_agg(value order by at desc) from others where kind = 'linkedin'), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'value', value) order by at desc) from others where kind = 'link'), '[]'::jsonb),
    'emails', coalesce((
      select jsonb_agg(v order by v) from (
        select lower(value) as v from entries where label ~ 'e-?mail'
        union
        select lower(email) from public.payment_contacts where user_id = p_user_id and nullif(email, '') is not null
      ) all_em
      where v <> (select lower(email) from auth.users where id = p_user_id)
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'paymentId', razorpay_payment_id, 'method', method, 'vpa', vpa, 'bank', bank, 'wallet', wallet,
        'amountPaise', amount_paise, 'status', status, 'createdAt', created_at
      ) order by created_at desc)
      from public.payment_contacts where user_id = p_user_id
    ), '[]'::jsonb),
    'cvNames', coalesce((
      select jsonb_agg(n) from (
        select distinct trim(data->>'name') as n from public.resumes
        where user_id = p_user_id and nullif(trim(data->>'name'), '') is not null
      ) nm
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.admin_user_contact(uuid) from public, anon, authenticated;

-- 0048's user detail plus: the contact block above, the Google name and
-- photo, when the email was confirmed, every sign-in method, the account's
-- last update, and how much the user did in the resume builder.
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
          'fullName', coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
          'avatarUrl', coalesce(pr.avatar_url, u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture'),
          'createdAt', u.created_at, 'lastSignInAt', u.last_sign_in_at,
          'updatedAt', u.updated_at, 'emailConfirmedAt', u.email_confirmed_at,
          'signUpProvider', u.raw_app_meta_data->>'provider',
          'providers', coalesce(u.raw_app_meta_data->'providers', '[]'::jsonb),
          'isOwner', exists (select 1 from public.admin_users a where a.user_id = u.id),
          'welcomeEmailSentAt', (select w.sent_at from public.welcome_emails w where w.user_id = u.id),
          'isBanned', coalesce(pr.is_banned, false),
          'banReason', pr.ban_reason,
          'bannedAt', pr.banned_at,
          'bannedByEmail', pr.banned_by_email
        )
        from auth.users u left join public.profiles pr on pr.id = u.id where u.id = p_user_id
      ),
      'contact', public.admin_user_contact(p_user_id),
      'resumeBuilder', jsonb_build_object(
        'resumes', (select count(*) from public.resumes where user_id = p_user_id),
        'aiRequests', (select count(*) from public.resume_ai_requests where user_id = p_user_id),
        'lastUsedAt', greatest(
          (select max(updated_at) from public.resumes where user_id = p_user_id),
          (select max(created_at) from public.resume_ai_requests where user_id = p_user_id)
        )
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
                 s.usage_deducted, s.termination_reason, s.client_kind, s.client_os, s.plan_id,
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

-- 0045's user list plus a phone column (the newest one from Razorpay, else
-- the newest one in a resume-builder CV -- uploaded CV text is left to the user page, so
-- the list doesn't scan every CV on each load), the Google name when the
-- profile has none, and search by phone or name as well as email / user id.
drop function public.admin_list_users(text, text, boolean, int, int, text, text);

create function public.admin_list_users(
  p_search text default null,
  p_plan_filter text default null,
  p_suspicious_only boolean default false,
  p_limit int default 50,
  p_offset int default 0,
  p_client_filter text default null, -- 'desktop' | 'browser' | 'website' | 'none'
  p_segment text default null -- what a dashboard card counted; see 0045
)
returns table (
  user_id uuid, email text, display_name text, phone text, created_at timestamptz, last_sign_in_at timestamptz,
  plan_id text, remaining_minutes numeric, total_purchased_minutes numeric, total_consumed_minutes numeric,
  interview_count bigint, transcript_count bigint, is_suspicious boolean, devices jsonb, last_seen_at timestamptz,
  is_owner boolean, total_count bigint
)
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.* from (
    with base as (
      select
        u.id as user_id, u.email::text as email,
        coalesce(pr.display_name, u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name') as display_name,
        coalesce(
          (
            select pc.contact from public.payment_contacts pc
            where pc.user_id = u.id and nullif(pc.contact, '') is not null
            order by pc.created_at desc limit 1
          ),
          '+' || nullif(u.phone, ''),
          (
            select trim(e->>'value')
            from public.resumes r
            cross join lateral jsonb_array_elements(
              case when jsonb_typeof(r.data->'contact') = 'array' then r.data->'contact' else '[]'::jsonb end
            ) e
            where r.user_id = u.id
              and lower(e->>'label') ~ '(phone|mobile|tel|cell|whatsapp|contact)'
              and length(regexp_replace(e->>'value', '\D', '', 'g')) >= 7
            order by r.updated_at desc
            limit 1
          )
        ) as phone,
        u.created_at, u.last_sign_in_at,
        e.plan_id, e.remaining_minutes,
        coalesce((select sum(p.included_minutes) from public.purchases pu join public.plans p on p.id = pu.plan_id where pu.user_id = u.id), 0) as total_purchased_minutes,
        coalesce((select sum(s.minutes_consumed) from public.interview_sessions s where s.user_id = u.id and s.minutes_consumed is not null), 0) as total_consumed_minutes,
        coalesce((select count(*) from public.interview_sessions s where s.user_id = u.id), 0) as interview_count,
        coalesce((select count(*) from public.interview_transcripts t where t.user_id = u.id), 0) as transcript_count,
        coalesce((
          select jsonb_agg(jsonb_build_object('kind', d.client_kind, 'os', d.os, 'appVersion', d.app_version, 'lastSeenAt', d.last_seen_at) order by d.last_seen_at desc)
          from public.user_devices d where d.user_id = u.id
        ), '[]'::jsonb) as devices,
        greatest(u.last_sign_in_at, (select max(d.last_seen_at) from public.user_devices d where d.user_id = u.id)) as last_seen_at,
        exists (select 1 from public.admin_users a where a.user_id = u.id) as is_owner
      from auth.users u
      join public.entitlements e on e.user_id = u.id
      left join public.profiles pr on pr.id = u.id
    ),
    flagged as (
      select *, (not is_owner and remaining_minutes > 15 + total_purchased_minutes) as is_suspicious from base
    ),
    filtered as (
      select * from flagged
      where (
          p_search is null or p_search = ''
          or email ilike '%' || p_search || '%'
          or display_name ilike '%' || p_search || '%'
          or user_id::text = p_search
          or (
            length(regexp_replace(p_search, '\D', '', 'g')) >= 4
            and regexp_replace(coalesce(phone, ''), '\D', '', 'g') like '%' || regexp_replace(p_search, '\D', '', 'g') || '%'
          )
        )
        and (p_plan_filter is null or (p_plan_filter = 'free' and plan_id = 'free') or (p_plan_filter = 'paid' and plan_id <> 'free'))
        and (not p_suspicious_only or is_suspicious)
        and (
          p_client_filter is null
          or (p_client_filter = 'none' and devices = '[]'::jsonb)
          or (p_client_filter <> 'none' and devices @> jsonb_build_array(jsonb_build_object('kind', p_client_filter)))
        )
        and (
          p_segment is null
          or (p_segment = 'joined_today' and created_at >= public.admin_period_start('today'))
          or (p_segment = 'joined_week' and created_at >= public.admin_period_start('week'))
          or (p_segment = 'joined_month' and created_at >= public.admin_period_start('month'))
          or (p_segment = 'active_7d' and last_seen_at >= now() - interval '7 days')
          or (p_segment = 'interviewed' and interview_count > 0)
          or (p_segment = 'never_interviewed' and interview_count = 0)
          or (p_segment = 'desktop_windows' and devices @> '[{"kind":"desktop","os":"windows"}]')
          or (p_segment = 'desktop_mac' and devices @> '[{"kind":"desktop","os":"macos"}]')
          or (p_segment = 'android' and devices @> '[{"kind":"browser","os":"android"}]')
          or (p_segment = 'ios' and devices @> '[{"kind":"browser","os":"ios"}]')
          or (p_segment = 'computer_browser' and exists (
                select 1 from jsonb_array_elements(devices) d
                where d->>'kind' = 'browser' and d->>'os' in ('windows', 'macos', 'linux')))
          or (p_segment = 'website_only' and not exists (
                select 1 from jsonb_array_elements(devices) d where d->>'kind' in ('desktop', 'browser')))
        )
    )
    select
      user_id, email, display_name, phone, created_at, last_sign_in_at, plan_id, remaining_minutes,
      total_purchased_minutes, total_consumed_minutes, interview_count, transcript_count, is_suspicious,
      devices, last_seen_at, is_owner, count(*) over () as total_count
    from filtered order by created_at desc limit p_limit offset p_offset
  ) f cross join _auth;
$$;

revoke all on function public.admin_list_users(text, text, boolean, int, int, text, text) from public, anon, authenticated;
grant execute on function public.admin_list_users(text, text, boolean, int, int, text, text) to authenticated, service_role;
