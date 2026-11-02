-- International pricing: buyers outside India pay in USD (Starter $9,
-- Pro $15, Pro+ $25), India stays in INR. Same minutes everywhere.
--
-- purchases.amount_paise / payment_contacts.amount_paise stay in rupees for
-- every row, so every revenue total in the admin console keeps adding up one
-- currency. For a USD payment that is Razorpay's converted base_amount (null
-- if Razorpay didn't send one). currency + amount_minor hold what the buyer
-- was actually charged, in that currency's smallest unit (paise or cents).

alter table public.plans add column if not exists price_usd_cents integer;
update public.plans set price_usd_cents = case id
  when 'free' then 0
  when 'starter' then 900
  when 'pro' then 1500
  when 'pro-plus' then 2500
end
where id in ('free', 'starter', 'pro', 'pro-plus');

alter table public.purchases alter column amount_paise drop not null;
alter table public.purchases add column if not exists currency text not null default 'INR';
alter table public.purchases add column if not exists amount_minor integer;
update public.purchases set amount_minor = amount_paise where amount_minor is null;

alter table public.payment_contacts add column if not exists currency text not null default 'INR';
alter table public.payment_contacts add column if not exists amount_minor integer;
update public.payment_contacts set amount_minor = amount_paise where amount_minor is null;

-- admin_list_payments: same as 0046, plus each payment's charged currency
-- and amount so the Payments page can show "$9 (₹756)".
drop function if exists public.admin_list_payments(text, int, int, text);
create function public.admin_list_payments(
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0,
  p_period text default null -- 'today' | 'week' | 'month'
)
returns table (
  ledger_id bigint, user_id uuid, email text, minutes_granted numeric, reference_id text, created_at timestamptz,
  webhook_recorded boolean, amount_paise integer, purchase_plan_id text, subscription_plan text,
  subscription_status text, is_repeat_credit boolean, total_paise bigint, payment_count bigint, total_count bigint,
  currency text, amount_minor integer
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
        row_number() over (partition by l.reference_id order by l.created_at) > 1 as is_repeat_credit,
        pu.currency, pu.amount_minor
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
      count(*) filter (where not is_repeat_credit and (amount_paise is not null or amount_minor is not null)) over () as payment_count,
      count(*) over () as total_count,
      currency,
      case when is_repeat_credit then null else amount_minor end as amount_minor
    from filtered order by created_at desc limit p_limit offset p_offset
  ) f cross join _auth;
$$;

revoke all on function public.admin_list_payments(text, int, int, text) from public, anon, authenticated;
grant execute on function public.admin_list_payments(text, int, int, text) to authenticated, service_role;

-- admin_notifications: same as 0049, plus the payment's currency/amount.
create or replace function public.admin_notifications(p_limit int default 40)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id()),
  since as (select now() - interval '7 days' as t),
  events as (
    select 'signup' as kind, u.id as user_id, u.created_at as at,
           jsonb_build_object('provider', u.raw_app_meta_data->>'provider') as detail
    from auth.users u, since where u.created_at >= since.t

    union all
    select 'payment', p.user_id, p.created_at,
           jsonb_build_object('planId', p.plan_id, 'amountPaise', p.amount_paise,
                              'currency', p.currency, 'amountMinor', p.amount_minor)
    from public.purchases p, since where p.created_at >= since.t
  )
  select coalesce(jsonb_agg(row order by (row->>'at')::timestamptz desc), '[]'::jsonb)
  from (
    select jsonb_build_object('kind', e.kind, 'userId', e.user_id, 'email', u.email, 'at', e.at, 'detail', e.detail) as row
    from events e
    join auth.users u on u.id = e.user_id
    where not exists (select 1 from public.admin_users a where a.user_id = e.user_id)
    order by e.at desc
    limit least(greatest(p_limit, 1), 100)
  ) r
  cross join _auth;
$$;

revoke all on function public.admin_notifications(int) from public, anon, authenticated;
grant execute on function public.admin_notifications(int) to authenticated, service_role;
