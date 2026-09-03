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
    0008_fix_plan_ids.sql            -- fixes plan ids to match the website (free/interview-pass/pro-monthly/pro-annual)
    0009_webhook_events.sql          -- idempotency table for the Razorpay webhook
  functions/
    llm-proxy/            -- forwards chat requests to OpenAI/Anthropic with OUR key, logs to usage_costs
    stt-token/             -- starts an interview_sessions row + mints a short-lived Deepgram key
    session-heartbeat/     -- client pings every ~30-90s to keep a session's last_heartbeat_at fresh
    usage-report/          -- client reports actual session duration when it ends
    razorpay-webhook/       -- keeps subscriptions + entitlements in sync with Razorpay
    request-otp/            -- sends a 4-digit login code (replaces Supabase's fixed-length /auth/v1/otp)
    verify-otp/              -- checks the code, mints a real Supabase session
    _shared/entitlement.ts -- auth + plan/balance check shared by the above
```

Design choice: **no request or response content is stored** — only usage
metadata (token counts, minutes, cost estimates) needed for metering.

## How the pieces fit the existing schema

- `entitlements.remaining_minutes` is a spendable balance (not a monthly
  reset counter) — it goes up via Razorpay events, down via `usage-report`.
  This matches `plans.billing_type` supporting `free`, `one_time`,
  `monthly`, and `yearly`.
- `interview_sessions` has a DB-level unique index
  (`interview_sessions_one_active_per_user`) allowing only one `active`
  session per user — `stt-token` relies on this and returns 409 if the
  insert collides.
- `0006_session_expiry_sweep.sql` adds a `pg_cron` job that marks sessions
  `expired` if `last_heartbeat_at` goes stale for 2+ minutes, so a crashed
  app doesn't permanently occupy that one-active-session slot. **Enable the
  `pg_cron` extension** (Database -> Extensions in the dashboard) before
  applying this migration.
- `0008_fix_plan_ids.sql` corrects a real bug: the original seed used ids
  (`free/starter/pro/power`) that never matched the website's actual plan
  ids (`free/interview-pass/pro-monthly/pro-annual`). Apply this before
  testing any real checkout.
- `webhook_events` (from `0009`) exists because Razorpay retries webhook
  deliveries that don't get acknowledged — without a dedupe check, a
  retried `order.paid`/`subscription.charged` would double-credit minutes.

## Applying migrations

The MCP connection used to inspect this project (from Claude's chat) is
**read-only by design** — it will not, and should not, push schema changes.
Apply pending migrations yourself via the Supabase dashboard's SQL Editor
(paste each file's contents and run, in order), or via the CLI:

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
supabase secrets set RAZORPAY_WEBHOOK_SECRET=<shown when you create the webhook in Razorpay's dashboard>
supabase secrets set RESEND_API_KEY=<from resend.com/api-keys — must be able to send from smallbird.in>
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically — don't set those yourself. `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`
are used by the **website's** server-side order/subscription creation, not by
this backend — set those in the website's hosting env instead.

## Deploy the functions

```powershell
supabase functions deploy llm-proxy
supabase functions deploy stt-token
supabase functions deploy session-heartbeat
supabase functions deploy usage-report
supabase functions deploy razorpay-webhook
supabase functions deploy request-otp
supabase functions deploy verify-otp
```

## Razorpay setup checklist

`plans` has rows with `id`, `included_minutes`, `price_inr_paise`,
`billing_type` matching the website exactly after `0008` is applied.

1. Create a Razorpay account, complete KYC. Test-mode keys work before KYC
   clears — enough to build and test everything below.
2. Create two Razorpay **Plans** (Dashboard -> Subscriptions -> Plans) for
   `pro-monthly` and `pro-annual` — Razorpay recurring billing needs a
   pre-existing Razorpay-side plan id, separate from `public.plans.id`.
3. When the website creates an Order (one-time, `interview-pass`) or a
   Subscription (`pro-monthly`/`pro-annual`) server-side, it must set
   `notes: { user_id: "<supabase user id>", plan_id: "<id from public.plans>" }`
   — Razorpay's free-form metadata equivalent (max 15 keys). This function
   reads `user_id`/`plan_id` from there; there's no `stripe_customer_id`-style
   column to look up instead.
4. Add a webhook endpoint (Dashboard -> Account & Settings -> Webhooks)
   pointing at
   `https://xubbwgrjvvsbfvxcuzav.supabase.co/functions/v1/razorpay-webhook`,
   subscribed to `order.paid`, `subscription.charged`, `subscription.cancelled`.
   Note the webhook secret shown at creation — that's `RAZORPAY_WEBHOOK_SECRET`.

## Every new user already starts on a plan

The existing `handle_new_user_entitlement` trigger gives every signup an
`entitlements` row on the `free` plan with `free`'s `included_minutes`.
Nothing here charges anyone until they go through Razorpay Checkout.

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
