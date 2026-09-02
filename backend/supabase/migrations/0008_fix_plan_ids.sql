-- Fixes a real bug: 0007 seeded plan ids (free/starter/pro/power) that don't
-- match the website's actual PlanId values (free/interview-pass/pro-monthly/
-- pro-annual). Any real checkout writing plan_id from the website would
-- reference a plan id this table never had. Additive migration rather than
-- editing 0007 in place, since 0007 already ran in production.

-- 'yearly' wasn't a prior billing_type value — extend the check constraint.
alter table public.plans drop constraint if exists plans_billing_type_check;
alter table public.plans add constraint plans_billing_type_check
  check (billing_type = any (array['free', 'one_time', 'monthly', 'yearly']));

insert into public.plans (id, display_name, price_inr_paise, billing_type, included_minutes, max_concurrent_sessions, is_active)
values
  ('free',          'Free',          0,      'free',     15,   1, true),
  ('interview-pass','Interview Pass',19900,  'one_time', 120,  1, true),
  ('pro-monthly',   'Pro Monthly',   69900,  'monthly',  400,  1, true),
  ('pro-annual',    'Pro Annual',    499900, 'yearly',   4000, 1, true)
on conflict (id) do update set
  display_name = excluded.display_name,
  price_inr_paise = excluded.price_inr_paise,
  billing_type = excluded.billing_type,
  included_minutes = excluded.included_minutes,
  max_concurrent_sessions = excluded.max_concurrent_sessions,
  is_active = excluded.is_active,
  updated_at = now();

-- Deactivate rather than hard-delete the stale ids, in case anything
-- (entitlements rows, FKs) still references them.
update public.plans set is_active = false, updated_at = now()
  where id in ('starter', 'pro', 'power');

-- Any entitlement still pointing at a retired plan id falls back to free
-- rather than referencing a deactivated plan.
update public.entitlements set plan_id = 'free', updated_at = now()
  where plan_id in ('starter', 'pro', 'power');
