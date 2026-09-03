-- Tracks each completed one-time purchase (Interview Pass today, any future
-- one-time pack later) so a user's purchase count/history is queryable —
-- webhook_events only records dedupe keys, not who bought what.

create table public.purchases (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id text not null references public.plans (id),
  amount_paise integer not null,
  razorpay_order_id text not null unique,
  created_at timestamptz not null default now()
);

alter table public.purchases enable row level security;

create policy "read own purchases" on public.purchases
  for select using (auth.uid() = user_id);
