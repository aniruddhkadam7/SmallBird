-- New lineup: Free + three one-time passes, no monthly plans.
--   Starter Pass ₹299 / 60 min, Pro Pass ₹559 / 120 min, Pro+ Pass ₹999 / 240 min.
-- Ids stay the same so existing entitlements/purchases keep pointing at them.
-- razorpay-webhook checks the paid amount against price_inr_paise, so these
-- prices must match the website's lib/plans.ts exactly.
update public.plans set display_name = 'Starter Pass', price_inr_paise = 29900, billing_type = 'one_time', included_minutes = 60,  is_active = true where id = 'starter';
update public.plans set display_name = 'Pro Pass',     price_inr_paise = 55900, billing_type = 'one_time', included_minutes = 120, is_active = true where id = 'pro';
update public.plans set display_name = 'Pro+ Pass',    price_inr_paise = 99900, billing_type = 'one_time', included_minutes = 240, is_active = true where id = 'pro-plus';

-- Max is retired; nobody ever bought it.
delete from public.plans where id = 'max';
