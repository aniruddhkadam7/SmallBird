-- Backs the custom 4-digit email OTP login flow (request-otp/verify-otp
-- functions). Supabase's built-in email OTP is fixed at 6+ digits with no
-- way to shorten it, so login goes through this table instead of
-- auth.v1/otp — see backend/supabase/functions/request-otp and verify-otp.

create table if not exists public.login_otps (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists login_otps_email_created_at_idx on public.login_otps (email, created_at desc);

alter table public.login_otps enable row level security;
-- No policies: only the service-role key (used exclusively by the two Edge
-- Functions above) can read or write this table. Anon/authenticated clients
-- get nothing, by default-deny.
