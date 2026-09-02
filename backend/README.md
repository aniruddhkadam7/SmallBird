# Smallbird backend

The auth/billing/metering layer that sits between the desktop app and the AI
providers. This runs against your existing **REDLY** Supabase project
(`xubbwgrjvvsbfvxcuzav`) — its schema was already in place (`profiles`,
`entitlements`, `plans`, `interview_sessions`, `usage_costs`, `usage_events`,
`subscriptions`, migrated through `0004_security_hardening`) before this
backend code was written; nothing here recreates or duplicates it.

## What's here

```
backend/supabase/
  migrations/
    0005_backend_rpc_functions.sql   -- adds increment/decrement_entitlement_minutes RPCs
    0006_session_expiry_sweep.sql    -- pg_cron job that expires abandoned sessions
  functions/
    llm-proxy/          -- forwards chat requests to OpenAI/Anthropic with OUR key, logs to usage_costs
    stt-token/           -- starts an interview_sessions row + mints a short-lived Deepgram key
    session-heartbeat/   -- client pings every ~30s to keep a session's last_heartbeat_at fresh
    usage-report/        -- client reports actual session duration when it ends
    stripe-webhook/       -- keeps subscriptions + entitlements in sync with Stripe
    _shared/entitlement.ts -- auth + plan/balance check shared by the above
```

Design choice: **no request or response content is stored** — only usage
metadata (token counts, minutes, cost estimates) needed for metering.

## How the pieces fit the existing schema

- `entitlements.remaining_minutes` is a spendable balance (not a monthly
  reset counter) — it goes up via Stripe events, down via `usage-report`.
  This matches `plans.billing_type` supporting both `monthly` subscriptions
  and `one_time` minute packs.
- `interview_sessions` has a DB-level unique index
  (`interview_sessions_one_active_per_user`) allowing only one `active`
  session per user — `stt-token` relies on this and returns 409 if the
  insert collides.
- `0006_session_expiry_sweep.sql` adds a `pg_cron` job that marks sessions
  `expired` if `last_heartbeat_at` goes stale for 2+ minutes, so a crashed
  app doesn't permanently occupy that one-active-session slot. **Enable the
  `pg_cron` extension** (Database -> Extensions in the dashboard) before
  applying this migration.

## Applying the new migrations

The MCP connection used to inspect this project (from this chat) is
**read-only by design** — it will not, and should not, push schema changes.
Apply `0005` and `0006` yourself via the Supabase dashboard's SQL Editor
(paste each file's contents and run), or via the CLI:

```powershell
cd backend
supabase login
supabase link --project-ref xubbwgrjvvsbfvxcuzav
supabase db push
```

## Secrets

Set these in the Supabase dashboard (Edge Functions -> Secrets) or via CLI:

```powershell
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set DEEPGRAM_API_KEY=<a Deepgram key with project key-management scope>
supabase secrets set DEEPGRAM_PROJECT_ID=<your Deepgram project id>
supabase secrets set STRIPE_SECRET_KEY=sk_test_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically — don't set those yourself.

## Deploy the functions

```powershell
supabase functions deploy llm-proxy
supabase functions deploy stt-token
supabase functions deploy session-heartbeat
supabase functions deploy usage-report
supabase functions deploy stripe-webhook
```

## Stripe setup checklist

`plans` already has rows with `id`, `included_minutes`, `price_inr_paise`,
`billing_type`. When you create the matching Products/Prices in Stripe:

1. When creating a Checkout Session from your website, set:
   - `client_reference_id`: the Supabase user id
   - `metadata: { plan_id: "<id from public.plans>" }`
   - For subscription-mode sessions, also set
     `subscription_data: { metadata: { user_id, plan_id } }` — this schema
     has no `stripe_customer_id`/`stripe_subscription_id` columns, so
     `user_id` travels via Stripe metadata instead of a DB lookup.
2. Add a webhook endpoint pointing at
   `https://xubbwgrjvvsbfvxcuzav.supabase.co/functions/v1/stripe-webhook`,
   subscribed to `checkout.session.completed`, `invoice.paid`,
   `customer.subscription.deleted`.

## Every new user already starts on a plan

The existing `handle_new_user_entitlement` trigger gives every signup an
`entitlements` row on the `free` plan with `free`'s `included_minutes`.
Nothing here charges anyone until they go through Stripe Checkout.

## Local testing

```powershell
supabase start
supabase functions serve
```

```powershell
curl -X POST http://localhost:54321/functions/v1/stt-token `
  -H "Authorization: Bearer <a real user jwt>" `
  -H "Content-Type: application/json" -d '{}'
```
