-- Idempotency guard for the Razorpay webhook: Razorpay retries webhook
-- deliveries that don't get acknowledged, and without this a retried
-- order.paid/subscription.charged event would double-credit minutes via
-- increment_entitlement_minutes. Written only by the service role from
-- within the webhook function — RLS enabled with no policies blocks all
-- client access by default.

create table public.webhook_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  entity_id text not null,
  created_at timestamptz not null default now(),
  unique (event_type, entity_id)
);

alter table public.webhook_events enable row level security;
