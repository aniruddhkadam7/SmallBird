-- Raises every paid plan by Rs 200: Starter 199 -> 399, Pro 499 -> 699,
-- Pro Plus 799 -> 999.
update public.plans set price_inr_paise = case id
    when 'starter'  then 39900
    when 'pro'      then 69900
    when 'pro-plus' then 99900
  end, updated_at = now()
  where id in ('starter', 'pro', 'pro-plus');
