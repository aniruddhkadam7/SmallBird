-- Earnings on Home: money received in total, today, this week and this
-- month (India time), from public.purchases -- one row per Razorpay payment,
-- one-time passes and subscription charges alike. The payments list gains
-- the same periods and marks repeat credits so a payment is never counted
-- twice.

create or replace function public.admin_dashboard_stats()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.jsonb_build_object from (
    select jsonb_build_object(
      'totalUsers', (select count(*) from public.entitlements),
      'freeUsers', (select count(*) from public.entitlements where plan_id = 'free'),
      'paidUsers', (select count(*) from public.entitlements where plan_id <> 'free'),
      'activeSubscriptions', (select count(*) from public.subscriptions where status = 'active'),
      'expiredSubscriptions', (select count(*) from public.subscriptions where status in ('canceled', 'halted')),
      'totalMinutesPurchased', (
        select coalesce(sum(p.included_minutes), 0)
        from public.purchases pu join public.plans p on p.id = pu.plan_id
      ),
      'totalMinutesConsumed', (
        select coalesce(sum(minutes_consumed), 0) from public.interview_sessions where minutes_consumed is not null
      ),
      'totalMinutesRemaining', (select coalesce(sum(remaining_minutes), 0) from public.entitlements),
      'totalInterviews', (select count(*) from public.interview_sessions),
      'interviewsToday', (select count(*) from public.interview_sessions where started_at >= public.admin_period_start('today')),
      'interviewsThisWeek', (select count(*) from public.interview_sessions where started_at >= public.admin_period_start('week')),
      'interviewsThisMonth', (select count(*) from public.interview_sessions where started_at >= public.admin_period_start('month')),
      'totalTranscripts', (select count(*) from public.interview_transcripts),
      'totalAiTokens', (select coalesce(sum(input_tokens + output_tokens), 0) from public.usage_costs),
      'estimatedAiCostUsd', (select coalesce(sum(estimated_cost_usd), 0) from public.usage_costs),
      'failedSessions', (select count(*) from public.interview_sessions where status in ('terminated', 'expired')),
      'suspiciousAccounts', (
        select count(*) from public.entitlements e
        where not exists (select 1 from public.admin_users a where a.user_id = e.user_id)
          and e.remaining_minutes > 15 + coalesce((
          select sum(p.included_minutes) from public.purchases pu
          join public.plans p on p.id = pu.plan_id
          where pu.user_id = e.user_id
        ), 0)
      ),
      'signupsToday', (select count(*) from auth.users where created_at >= public.admin_period_start('today')),
      'signupsThisWeek', (select count(*) from auth.users where created_at >= public.admin_period_start('week')),
      'signupsThisMonth', (select count(*) from auth.users where created_at >= public.admin_period_start('month')),
      'activeUsers7d', (
        select count(distinct x.user_id) from (
          select id as user_id from auth.users where last_sign_in_at >= now() - interval '7 days'
          union all
          select user_id from public.user_devices where last_seen_at >= now() - interval '7 days'
        ) x
      ),
      'usersNeverInterviewed', (
        select count(*) from public.entitlements e
        where not exists (select 1 from public.interview_sessions s where s.user_id = e.user_id)
      ),
      'earnings', (
        select jsonb_build_object(
          'totalPaise', coalesce(sum(amount_paise), 0),
          'totalCount', count(*),
          'todayPaise', coalesce(sum(amount_paise) filter (where created_at >= public.admin_period_start('today')), 0),
          'todayCount', count(*) filter (where created_at >= public.admin_period_start('today')),
          'weekPaise', coalesce(sum(amount_paise) filter (where created_at >= public.admin_period_start('week')), 0),
          'weekCount', count(*) filter (where created_at >= public.admin_period_start('week')),
          'monthPaise', coalesce(sum(amount_paise) filter (where created_at >= public.admin_period_start('month')), 0),
          'monthCount', count(*) filter (where created_at >= public.admin_period_start('month'))
        )
        from public.purchases
      ),
      'devices', jsonb_build_object(
        'desktopUsers', (select count(distinct user_id) from public.user_devices where client_kind = 'desktop'),
        'desktopWindows', (select count(distinct user_id) from public.user_devices where client_kind = 'desktop' and os = 'windows'),
        'desktopMac', (select count(distinct user_id) from public.user_devices where client_kind = 'desktop' and os = 'macos'),
        'browserUsers', (select count(distinct user_id) from public.user_devices where client_kind = 'browser'),
        'phoneUsers', (select count(distinct user_id) from public.user_devices where client_kind = 'browser' and os in ('android', 'ios')),
        'androidUsers', (select count(distinct user_id) from public.user_devices where client_kind = 'browser' and os = 'android'),
        'iosUsers', (select count(distinct user_id) from public.user_devices where client_kind = 'browser' and os = 'ios'),
        'computerBrowserUsers', (select count(distinct user_id) from public.user_devices where client_kind = 'browser' and os in ('windows', 'macos', 'linux')),
        'websiteOnlyUsers', (
          select count(*) from public.entitlements e
          where not exists (select 1 from public.user_devices d where d.user_id = e.user_id and d.client_kind in ('desktop', 'browser'))
        )
      )
    )
  ) f cross join _auth;
$$;

revoke all on function public.admin_dashboard_stats() from public, anon, authenticated;
grant execute on function public.admin_dashboard_stats() to authenticated, service_role;

drop function public.admin_list_payments(text, int, int);

-- One row per minute grant (a PURCHASE ledger entry), traced to its
-- payment. A payment that granted minutes more than once (a webhook that
-- ran twice) shows its later grants as is_repeat_credit, with no amount, so
-- totals count each payment once. total_paise / payment_count are the
-- money and payments across every row matching the filters.
create function public.admin_list_payments(
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0,
  p_period text default null -- 'today' | 'week' | 'month'
)
returns table (
  ledger_id bigint, user_id uuid, email text, minutes_granted numeric, reference_id text, created_at timestamptz,
  webhook_recorded boolean, amount_paise integer, purchase_plan_id text, subscription_plan text,
  subscription_status text, is_repeat_credit boolean, total_paise bigint, payment_count bigint, total_count bigint
)
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.* from (
    with base as (
      select
        l.id as ledger_id, l.user_id, u.email::text as email, l.delta as minutes_granted, l.reference_id, l.created_at,
        exists(select 1 from public.webhook_events w where w.entity_id = l.reference_id) as webhook_recorded,
        pu.amount_paise, pu.plan_id as purchase_plan_id, sub.plan as subscription_plan, sub.status as subscription_status,
        row_number() over (partition by l.reference_id order by l.created_at) > 1 as is_repeat_credit
      from public.entitlement_ledger l
      join auth.users u on u.id = l.user_id
      left join public.purchases pu on pu.razorpay_order_id = l.reference_id
      left join public.subscriptions sub on sub.user_id = l.user_id
      where l.source = 'PURCHASE'
    ),
    filtered as (
      select * from base
      where (p_search is null or p_search = '' or email ilike '%' || p_search || '%' or reference_id ilike '%' || p_search || '%')
        and (p_period is null or created_at >= public.admin_period_start(p_period))
    )
    select
      ledger_id, user_id, email, minutes_granted, reference_id, created_at, webhook_recorded,
      case when is_repeat_credit then null else amount_paise end as amount_paise,
      purchase_plan_id, subscription_plan, subscription_status, is_repeat_credit,
      coalesce(sum(case when is_repeat_credit then 0 else amount_paise end) over (), 0)::bigint as total_paise,
      count(*) filter (where not is_repeat_credit and amount_paise is not null) over () as payment_count,
      count(*) over () as total_count
    from filtered order by created_at desc limit p_limit offset p_offset
  ) f cross join _auth;
$$;

revoke all on function public.admin_list_payments(text, int, int, text) from public, anon, authenticated;
grant execute on function public.admin_list_payments(text, int, int, text) to authenticated, service_role;
