-- 0062's user list plus each user's photo (their profile photo, else the
-- Google one), so the Users list shows faces instead of only initials.
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
  user_id uuid, email text, display_name text, avatar_url text, phone text, created_at timestamptz, last_sign_in_at timestamptz,
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
        coalesce(pr.avatar_url, u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture') as avatar_url,
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
      user_id, email, display_name, avatar_url, phone, created_at, last_sign_in_at, plan_id, remaining_minutes,
      total_purchased_minutes, total_consumed_minutes, interview_count, transcript_count, is_suspicious,
      devices, last_seen_at, is_owner, count(*) over () as total_count
    from filtered order by created_at desc limit p_limit offset p_offset
  ) f cross join _auth;
$$;

revoke all on function public.admin_list_users(text, text, boolean, int, int, text, text) from public, anon, authenticated;
grant execute on function public.admin_list_users(text, text, boolean, int, int, text, text) to authenticated, service_role;
