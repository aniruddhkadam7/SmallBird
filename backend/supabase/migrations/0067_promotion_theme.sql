-- Festive animation for a website announcement (admin console Pricing &
-- Offers): Diwali fireworks, New Year, confetti, or none.
alter table public.site_promotions
  add column if not exists theme text not null default 'none'
  check (theme in ('none', 'diwali', 'newyear', 'confetti'));
