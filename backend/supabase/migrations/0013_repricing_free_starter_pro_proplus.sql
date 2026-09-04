-- Replaces the plans lineup: Free / Starter / Pro / Pro Plus, dropping the
-- Interview Pass / Pro Monthly / Pro Annual naming and the yearly billing
-- tier entirely. Same deactivate-rather-than-delete approach 0008 used for
-- its own stale ids, rather than a hard delete -- `purchases` has zero rows
-- in production as of this migration (the payment gateway only went live
-- today), so a delete would technically be safe too, but there's no reason
-- to take that risk when deactivating is just as effective and reversible.

insert into public.plans (id, display_name, price_inr_paise, billing_type, included_minutes, max_concurrent_sessions, is_active)
values
  ('free',      'Free',      0,     'free',     10,  1, true),
  ('starter',   'Starter',   19900, 'one_time', 60,  1, true),
  ('pro',       'Pro',       49900, 'monthly',  180, 1, true),
  ('pro-plus',  'Pro Plus',  79900, 'monthly',  360, 1, true)
on conflict (id) do update set
  display_name = excluded.display_name,
  price_inr_paise = excluded.price_inr_paise,
  billing_type = excluded.billing_type,
  included_minutes = excluded.included_minutes,
  max_concurrent_sessions = excluded.max_concurrent_sessions,
  is_active = excluded.is_active,
  updated_at = now();

-- Retire the previous lineup's ids -- the website/desktop app stop
-- referencing these the moment this migration's paired code change ships,
-- so nothing should create new rows against them going forward.
update public.plans set is_active = false, updated_at = now()
  where id in ('interview-pass', 'pro-monthly', 'pro-annual');

-- Any entitlement still pointing at a retired plan id falls back to free,
-- same fallback 0008 used -- there's no real subscriber on these ids yet
-- to migrate more carefully.
update public.entitlements set plan_id = 'free', updated_at = now()
  where plan_id in ('interview-pass', 'pro-monthly', 'pro-annual');
