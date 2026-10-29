-- The header bell: who registered and who paid in the last 7 days, newest
-- first. Staff accounts are left out
-- so test sign-ups and test payments don't show up. The console calls this
-- RPC directly from the browser (no Edge Function); its admin check is inside.

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
           jsonb_build_object('planId', p.plan_id, 'amountPaise', p.amount_paise)
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
