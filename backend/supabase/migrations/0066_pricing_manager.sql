-- Pricing manager: sales, safe price changes and site announcements, all
-- driven from the database so they go live without a website deploy.
-- Managed with the pricing-manager Claude skill (.claude/skills/pricing-manager).

-- A sale is a temporary price on a plan. It is live while
--   sale_price_* is set, sale_starts_at (if set) has passed, and
--   sale_ends_at (if set) hasn't.
-- End a sale by setting sale_ends_at = now() rather than clearing it, so
-- payments started at the sale price just before it ended still credit
-- (see plan_accepts_amount below).
alter table public.plans
  add column if not exists sale_price_inr_paise integer check (sale_price_inr_paise > 0),
  add column if not exists sale_price_usd_cents integer check (sale_price_usd_cents > 0),
  add column if not exists sale_label text,
  add column if not exists sale_starts_at timestamptz,
  add column if not exists sale_ends_at timestamptz,
  -- Kept automatically by the trigger below whenever a regular price changes.
  add column if not exists previous_price_inr_paise integer,
  add column if not exists previous_price_usd_cents integer,
  add column if not exists price_changed_at timestamptz;

create or replace function public.plans_remember_previous_price()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.price_inr_paise is distinct from old.price_inr_paise
     or new.price_usd_cents is distinct from old.price_usd_cents then
    new.previous_price_inr_paise := old.price_inr_paise;
    new.previous_price_usd_cents := old.price_usd_cents;
    new.price_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists plans_remember_previous_price on public.plans;
create trigger plans_remember_previous_price
  before update on public.plans
  for each row execute function public.plans_remember_previous_price();

-- Whether a payment of `p_amount` (smallest unit) in `p_currency` is a valid
-- price for `p_plan_id`. Used by razorpay-webhook before crediting minutes.
-- Accepts the current regular price, a sale price that is live or ended in
-- the last 24 hours, and the previous regular price for 24 hours after a
-- price change -- so a buyer who opened checkout just before a change still
-- gets their minutes.
create or replace function public.plan_accepts_amount(p_plan_id text, p_currency text, p_amount integer)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.plans p
    where p.id = p_plan_id
      and p.is_active
      and p_amount in (
        case p_currency when 'USD' then p.price_usd_cents when 'INR' then p.price_inr_paise end,
        case when (p.sale_starts_at is null or p.sale_starts_at <= now())
               and (p.sale_ends_at is null or p.sale_ends_at > now() - interval '24 hours')
             then case p_currency when 'USD' then p.sale_price_usd_cents when 'INR' then p.sale_price_inr_paise end
        end,
        case when p.price_changed_at > now() - interval '24 hours'
             then case p_currency when 'USD' then p.previous_price_usd_cents when 'INR' then p.previous_price_inr_paise end
        end
      )
  );
$$;

revoke all on function public.plan_accepts_amount(text, text, integer) from public, anon, authenticated;
grant execute on function public.plan_accepts_amount(text, text, integer) to service_role;

-- Announcements on the website: a strip above the nav (show_banner) and/or a
-- one-time popup (show_popup), live between starts_at and ends_at. Used for
-- sales ("Diwali Sale — 30% off all passes") but works for any message.
create table if not exists public.site_promotions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text,
  cta_label text,
  cta_href text,
  show_banner boolean not null default true,
  show_popup boolean not null default false,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  check (show_banner or show_popup),
  check (ends_at is null or ends_at > starts_at)
);

alter table public.site_promotions enable row level security;

-- Public site content: anyone may read; only the service role (and the
-- pricing-manager skill via SQL) writes.
drop policy if exists site_promotions_select_all on public.site_promotions;
create policy site_promotions_select_all on public.site_promotions
  for select to anon, authenticated using (true);
