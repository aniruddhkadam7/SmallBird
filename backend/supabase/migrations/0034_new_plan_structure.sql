-- New plan lineup: Free / Starter / Pro / Pro+ / Max
-- Starter unchanged (Rs399, 60 min). Pro restructured: fewer minutes, lower
-- per-minute cost at higher tiers creates a clear upgrade incentive.
-- pro-plus renamed to Pro+ with updated price/minutes; Max added as new tier.

update public.plans set
  price_inr_paise = 74900,
  included_minutes = 120,
  updated_at = now()
  where id = 'pro';

update public.plans set
  display_name = 'Pro+',
  price_inr_paise = 139900,
  included_minutes = 240,
  updated_at = now()
  where id = 'pro-plus';

insert into public.plans (id, display_name, price_inr_paise, billing_type, included_minutes, max_concurrent_sessions, is_active)
values ('max', 'Max', 259900, 'monthly', 480, 1, true)
on conflict (id) do update set
  display_name = excluded.display_name,
  price_inr_paise = excluded.price_inr_paise,
  billing_type = excluded.billing_type,
  included_minutes = excluded.included_minutes,
  max_concurrent_sessions = excluded.max_concurrent_sessions,
  is_active = excluded.is_active,
  updated_at = now();
