-- OpenAI credit balance for the admin console's AI usage page.
--
-- OpenAI's API has no endpoint for the prepaid credit balance, even with an
-- admin key -- only spend (/v1/organization/costs). So the admin copies the
-- balance from platform.openai.com/settings/organization/billing once, with
-- the time they read it, and admin-openai-balance subtracts the spend since
-- then. Re-enter it after each top-up.

insert into public.app_settings (key, value, description) values
  (
    'openai_balance_usd',
    '',
    'OpenAI credit balance (USD) as shown on the OpenAI billing page when it was last entered. Empty = not set.'
  ),
  (
    'openai_balance_set_at',
    '',
    'ISO time openai_balance_usd was read from the OpenAI billing page. Spend after this time is subtracted from it.'
  )
on conflict (key) do nothing;
