-- Website traffic for the admin console's Analytics page: every page view,
-- how long it was looked at, and key clicks (download, buy), with where the
-- visitor came from (referrer, utm_* tags), device and rough location.
--
-- The website's /api/track route adds Vercel's geo headers and the signed-in
-- user's token and hands each event to the `track` Edge Function, the only
-- writer (service role). visitor_id is a random id kept in the browser;
-- once that visitor signs in, all their events get user_id, so a sign-up or
-- a payment can be credited to the channel that first brought them.
-- Admin-only: no policies, read through admin_web_analytics below.
create table if not exists public.web_events (
  id uuid primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('view', 'event')),
  name text,                 -- event name, e.g. download_windows; null for views
  visitor_id text not null,
  session_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  path text not null,
  referrer text,
  referrer_host text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  country text,
  region text,
  city text,
  device text,               -- mobile | tablet | desktop
  browser text,
  os text,
  duration_ms integer        -- time on the page, set when the visitor leaves it
);

create index if not exists web_events_created_at_idx on public.web_events (created_at);
create index if not exists web_events_visitor_id_idx on public.web_events (visitor_id, created_at);
create index if not exists web_events_session_id_idx on public.web_events (session_id, created_at);
create index if not exists web_events_user_id_idx on public.web_events (user_id) where user_id is not null;

alter table public.web_events enable row level security;
revoke all on public.web_events from public, anon, authenticated;

-- Where a visit came from, in the buckets the Analytics page reports on.
create or replace function public.web_channel(p_referrer_host text, p_utm_source text, p_utm_medium text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(coalesce(p_utm_medium, '')) ~ '(cpc|ppc|paid|ads?$|display)' then 'Paid ads'
    when lower(coalesce(p_utm_medium, '')) ~ '(email|newsletter)' then 'Email'
    when lower(coalesce(p_utm_source, '') || ' ' || coalesce(p_referrer_host, ''))
         ~ '(facebook|fb\.|instagram|t\.co|twitter|x\.com|linkedin|lnkd|youtube|youtu\.be|reddit|whatsapp|wa\.me|telegram|t\.me|quora|discord|threads)' then 'Social'
    when lower(coalesce(p_utm_source, '') || ' ' || coalesce(p_referrer_host, ''))
         ~ '(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|brave|perplexity|chatgpt|openai)' then
      case when lower(coalesce(p_utm_source, '') || ' ' || coalesce(p_referrer_host, '')) ~ '(perplexity|chatgpt|openai)' then 'AI search' else 'Search' end
    when nullif(p_utm_source, '') is not null then 'Campaign'
    when nullif(p_referrer_host, '') is null or p_referrer_host ~ 'smallbird' then 'Direct'
    else 'Referral'
  end;
$$;

-- Everything on the Analytics page for the last p_days days (India time),
-- with the previous period's headline numbers for comparison. Staff and
-- their browsers are left out.
create or replace function public.admin_web_analytics(p_days int default 30)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id()),
  bounds as (
    select now() - make_interval(days => greatest(1, least(p_days, 365))) as since,
           now() - make_interval(days => 2 * greatest(1, least(p_days, 365))) as prev_since
  ),
  staff_visitors as (
    select distinct visitor_id from public.web_events
    where user_id in (select user_id from public.admin_users)
  ),
  ev_all as (
    select e.* from public.web_events e
    where e.created_at >= (select prev_since from bounds)
      and e.visitor_id not in (select visitor_id from staff_visitors)
  ),
  ev as (select * from ev_all where created_at >= (select since from bounds)),
  views as (select * from ev where kind = 'view'),
  -- One row per visit (session): where it started and how it went.
  sessions as (
    select
      session_id,
      min(visitor_id) as visitor_id,
      min(created_at) as started_at,
      (array_agg(path order by created_at))[1] as landing,
      (array_agg(path order by created_at desc))[1] as exit_path,
      (array_agg(public.web_channel(referrer_host, utm_source, utm_medium) order by created_at))[1] as channel,
      (array_agg(coalesce(nullif(utm_source, ''), referrer_host, '(direct)') order by created_at))[1] as source,
      (array_agg(utm_campaign order by created_at))[1] as campaign,
      (array_agg(device order by created_at))[1] as device,
      (array_agg(country order by created_at))[1] as country,
      count(*) as pages,
      coalesce(sum(duration_ms), 0) as duration_ms
    from views group by session_id
  ),
  -- A visitor's first ever visit decides their channel (first touch).
  visitor_first as (
    select distinct on (visitor_id) visitor_id,
      public.web_channel(referrer_host, utm_source, utm_medium) as channel,
      coalesce(nullif(utm_source, ''), referrer_host, '(direct)') as source,
      utm_campaign as campaign, path as landing, device, country
    from public.web_events where kind = 'view'
    order by visitor_id, created_at
  ),
  user_first as (
    select distinct on (e.user_id) e.user_id, vf.*
    from public.web_events e join visitor_first vf on vf.visitor_id = e.visitor_id
    where e.user_id is not null
    order by e.user_id, e.created_at
  ),
  signups as (
    select u.id as user_id, u.created_at,
      coalesce(uf.channel, 'Not tracked') as channel,
      coalesce(uf.source, 'Not tracked') as source,
      uf.campaign, coalesce(uf.landing, 'Not tracked') as landing, uf.device, uf.country,
      exists (select 1 from public.interview_sessions s where s.user_id = u.id) as used_app,
      exists (select 1 from public.purchases p where p.user_id = u.id) as paid
    from auth.users u
    left join user_first uf on uf.user_id = u.id
    where u.created_at >= (select since from bounds)
      and not exists (select 1 from public.admin_users a where a.user_id = u.id)
  ),
  paid_in_range as (
    select p.user_id, sum(p.amount_paise) as paise
    from public.purchases p
    where p.created_at >= (select since from bounds)
      and not exists (select 1 from public.admin_users a where a.user_id = p.user_id)
    group by p.user_id
  ),
  paid_attr as (
    select pr.user_id, pr.paise, coalesce(uf.channel, 'Not tracked') as channel,
           coalesce(uf.source, 'Not tracked') as source, coalesce(uf.landing, 'Not tracked') as landing
    from paid_in_range pr left join user_first uf on uf.user_id = pr.user_id
  ),
  days as (
    select generate_series(
      ((select since from bounds) at time zone 'Asia/Kolkata')::date,
      (now() at time zone 'Asia/Kolkata')::date, interval '1 day')::date as day
  ),
  prev as (
    select
      count(distinct visitor_id) filter (where kind = 'view') as visitors,
      count(distinct session_id) filter (where kind = 'view') as sessions,
      count(*) filter (where kind = 'view') as pageviews
    from ev_all where created_at < (select since from bounds)
  )
  select jsonb_build_object(
    'days', greatest(1, least(p_days, 365)),
    'trackingSince', (select min(created_at) from public.web_events),
    'totals', jsonb_build_object(
      'visitors', (select count(distinct visitor_id) from views),
      'newVisitors', (select count(*) from visitor_first vf where vf.visitor_id in (select visitor_id from views)
                       and not exists (select 1 from public.web_events e where e.visitor_id = vf.visitor_id and e.created_at < (select since from bounds))),
      'sessions', (select count(*) from sessions),
      'pageviews', (select count(*) from views),
      'avgSessionSec', (select coalesce(round(avg(duration_ms) / 1000.0), 0) from sessions),
      'pagesPerSession', (select coalesce(round(avg(pages)::numeric, 2), 0) from sessions),
      'bounceRate', (select coalesce(round(100.0 * count(*) filter (where pages = 1) / nullif(count(*), 0), 1), 0) from sessions),
      'signups', (select count(*) from signups),
      'signupsTracked', (select count(*) from signups where channel <> 'Not tracked'),
      'usedApp', (select count(*) from signups where used_app),
      'paidUsers', (select count(*) from paid_in_range),
      'revenuePaise', (select coalesce(sum(paise), 0) from paid_in_range),
      'downloadClicks', (select count(*) from ev where kind = 'event' and name like 'download%'),
      'buyClicks', (select count(*) from ev where kind = 'event' and name like 'buy%')
    ),
    'previous', (select to_jsonb(prev) || jsonb_build_object(
      'signups', (select count(*) from auth.users u where u.created_at >= (select prev_since from bounds) and u.created_at < (select since from bounds)
                  and not exists (select 1 from public.admin_users a where a.user_id = u.id))
    ) from prev),
    'daily', (
      select jsonb_agg(jsonb_build_object(
        'day', d.day,
        'visitors', (select count(distinct visitor_id) from views v where (v.created_at at time zone 'Asia/Kolkata')::date = d.day),
        'pageviews', (select count(*) from views v where (v.created_at at time zone 'Asia/Kolkata')::date = d.day),
        'signups', (select count(*) from signups s where (s.created_at at time zone 'Asia/Kolkata')::date = d.day),
        'paid', (select count(*) from public.purchases p where (p.created_at at time zone 'Asia/Kolkata')::date = d.day
                  and not exists (select 1 from public.admin_users a where a.user_id = p.user_id))
      ) order by d.day) from days d
    ),
    'channels', (
      select coalesce(jsonb_agg(c order by (c->>'sessions')::int desc, (c->>'signups')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'channel', ch,
          'visitors', (select count(distinct visitor_id) from sessions s where s.channel = ch),
          'sessions', (select count(*) from sessions s where s.channel = ch),
          'bounceRate', (select coalesce(round(100.0 * count(*) filter (where pages = 1) / nullif(count(*), 0), 1), 0) from sessions s where s.channel = ch),
          'avgSessionSec', (select coalesce(round(avg(duration_ms) / 1000.0), 0) from sessions s where s.channel = ch),
          'signups', (select count(*) from signups g where g.channel = ch),
          'paid', (select count(*) from paid_attr p where p.channel = ch),
          'revenuePaise', (select coalesce(sum(paise), 0) from paid_attr p where p.channel = ch)
        ) as c
        from (select channel as ch from sessions union select channel from signups union select channel from paid_attr) x
      ) t
    ),
    'sources', (
      select coalesce(jsonb_agg(c order by (c->>'sessions')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'source', src,
          'channel', (select min(channel) from sessions s where s.source = src),
          'sessions', (select count(*) from sessions s where s.source = src),
          'visitors', (select count(distinct visitor_id) from sessions s where s.source = src),
          'bounceRate', (select coalesce(round(100.0 * count(*) filter (where pages = 1) / nullif(count(*), 0), 1), 0) from sessions s where s.source = src),
          'signups', (select count(*) from signups g where g.source = src),
          'paid', (select count(*) from paid_attr p where p.source = src)
        ) as c
        from (select distinct source as src from sessions) x
        order by (select count(*) from sessions s where s.source = x.src) desc
        limit 25
      ) t
    ),
    'campaigns', (
      select coalesce(jsonb_agg(c order by (c->>'sessions')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'campaign', camp,
          'sessions', (select count(*) from sessions s where s.campaign = camp),
          'visitors', (select count(distinct visitor_id) from sessions s where s.campaign = camp),
          'signups', (select count(*) from signups g where g.campaign = camp)
        ) as c
        from (select distinct campaign as camp from sessions where nullif(campaign, '') is not null) x
      ) t
    ),
    'landingPages', (
      select coalesce(jsonb_agg(c order by (c->>'sessions')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'path', lp,
          'sessions', (select count(*) from sessions s where s.landing = lp),
          'visitors', (select count(distinct visitor_id) from sessions s where s.landing = lp),
          'bounceRate', (select coalesce(round(100.0 * count(*) filter (where pages = 1) / nullif(count(*), 0), 1), 0) from sessions s where s.landing = lp),
          'avgSessionSec', (select coalesce(round(avg(duration_ms) / 1000.0), 0) from sessions s where s.landing = lp),
          'signups', (select count(*) from signups g where g.landing = lp),
          'paid', (select count(*) from paid_attr p where p.landing = lp)
        ) as c
        from (select distinct landing as lp from sessions) x
        order by (select count(*) from sessions s where s.landing = x.lp) desc
        limit 30
      ) t
    ),
    'pages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'path', path, 'views', views, 'visitors', visitors, 'avgSec', avg_sec, 'exits', exits
      ) order by views desc), '[]'::jsonb) from (
        select v.path, count(*) as views, count(distinct v.visitor_id) as visitors,
               coalesce(round(avg(v.duration_ms) filter (where v.duration_ms is not null) / 1000.0), 0) as avg_sec,
               (select count(*) from sessions s where s.exit_path = v.path) as exits
        from views v group by v.path order by count(*) desc limit 40
      ) p
    ),
    'countries', (
      select coalesce(jsonb_agg(jsonb_build_object('name', name, 'visitors', visitors, 'signups', signups) order by visitors desc), '[]'::jsonb) from (
        select coalesce(country, 'Unknown') as name, count(distinct visitor_id) as visitors,
               (select count(*) from signups g where coalesce(g.country, 'Unknown') = coalesce(v.country, 'Unknown') and g.channel <> 'Not tracked') as signups
        from views v group by coalesce(country, 'Unknown'), v.country order by 2 desc limit 20
      ) t
    ),
    'cities', (
      select coalesce(jsonb_agg(jsonb_build_object('name', name, 'visitors', visitors) order by visitors desc), '[]'::jsonb) from (
        select concat_ws(', ', nullif(city, ''), nullif(region, ''), country) as name, count(distinct visitor_id) as visitors
        from views where nullif(city, '') is not null group by 1 order by 2 desc limit 20
      ) t
    ),
    'devices', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', d, 'visitors', (select count(distinct visitor_id) from sessions s where coalesce(s.device, 'unknown') = d),
        'bounceRate', (select coalesce(round(100.0 * count(*) filter (where pages = 1) / nullif(count(*), 0), 1), 0) from sessions s where coalesce(s.device, 'unknown') = d),
        'signups', (select count(*) from signups g where coalesce(g.device, 'unknown') = d and g.channel <> 'Not tracked')
      )), '[]'::jsonb)
      from (select distinct coalesce(device, 'unknown') as d from sessions) x
    ),
    'browsers', (
      select coalesce(jsonb_agg(jsonb_build_object('name', name, 'visitors', n) order by n desc), '[]'::jsonb) from (
        select coalesce(browser, 'Other') as name, count(distinct visitor_id) n from views group by 1 order by 2 desc limit 10
      ) t
    ),
    'os', (
      select coalesce(jsonb_agg(jsonb_build_object('name', name, 'visitors', n) order by n desc), '[]'::jsonb) from (
        select coalesce(os, 'Other') as name, count(distinct visitor_id) n from views group by 1 order by 2 desc limit 10
      ) t
    ),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', n, 'visitors', vis) order by n desc), '[]'::jsonb) from (
        select name, count(*) n, count(distinct visitor_id) vis from ev where kind = 'event' group by name
      ) t
    ),
    'hours', (
      select jsonb_agg(jsonb_build_object('hour', h, 'pageviews',
        (select count(*) from views v where extract(hour from v.created_at at time zone 'Asia/Kolkata') = h)) order by h)
      from generate_series(0, 23) h
    ),
    'funnel', jsonb_build_object(
      'visitors', (select count(distinct visitor_id) from views),
      'sawPricing', (select count(distinct visitor_id) from views where path like '/pricing%'),
      'sawDownload', (select count(distinct visitor_id) from views where path like '/download%'),
      'clickedDownloadOrBuy', (select count(distinct visitor_id) from ev where kind = 'event' and (name like 'download%' or name like 'buy%')),
      'signedUp', (select count(*) from signups),
      'usedApp', (select count(*) from signups where used_app),
      'paid', (select count(*) from signups where paid)
    )
  )
  from _auth;
$$;

revoke all on function public.admin_web_analytics(int) from public, anon, authenticated;
grant execute on function public.admin_web_analytics(int) to authenticated, service_role;
