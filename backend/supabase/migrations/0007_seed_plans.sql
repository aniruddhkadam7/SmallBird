-- Seeds public.plans. This is not optional cosmetic data: the existing
-- handle_new_user_entitlement trigger does
--   select included_minutes from public.plans where id = 'free'
-- on every signup — without a 'free' row, new users get a NULL minute
-- balance. Apply this before any real user signs up.

insert into public.plans (id, display_name, price_inr_paise, billing_type, included_minutes, max_concurrent_sessions, is_active)
values
  ('free',    'Free',         0,      'free',    15,   1, true),
  ('starter', 'Starter Pack', 19900,  'one_time', 60,  1, true),
  ('pro',     'Pro',          59900,  'monthly',  300, 1, true),
  ('power',   'Power',        149900, 'monthly',  1000, 1, true)
on conflict (id) do update set
  display_name = excluded.display_name,
  price_inr_paise = excluded.price_inr_paise,
  billing_type = excluded.billing_type,
  included_minutes = excluded.included_minutes,
  max_concurrent_sessions = excluded.max_concurrent_sessions,
  is_active = excluded.is_active,
  updated_at = now();
