-- Adds the two RPCs the Edge Functions need for atomic minute accounting
-- against the existing `entitlements` table. Nothing here touches existing
-- tables/columns — additive only. Apply via the Supabase SQL editor or
-- `supabase db push` from the backend/ directory.

-- Called by usage-report when an interview session ends, to deduct actual
-- minutes consumed from the user's remaining balance. Never goes negative.
create or replace function public.decrement_entitlement_minutes(p_user_id uuid, p_minutes numeric)
returns void as $$
begin
  update public.entitlements
  set remaining_minutes = greatest(remaining_minutes - p_minutes, 0),
      updated_at = now()
  where user_id = p_user_id;
end;
$$ language plpgsql security definer set search_path = public;

-- Called by stripe-webhook on a successful payment/renewal to top up a
-- user's balance (one-time pack purchase, or monthly renewal).
create or replace function public.increment_entitlement_minutes(p_user_id uuid, p_minutes numeric)
returns void as $$
begin
  update public.entitlements
  set remaining_minutes = remaining_minutes + p_minutes,
      updated_at = now()
  where user_id = p_user_id;
end;
$$ language plpgsql security definer set search_path = public;
