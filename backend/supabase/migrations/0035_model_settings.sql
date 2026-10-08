-- 0035: Admin-configurable LLM model overrides stored in app_settings.
-- The desktop app sends gpt-6-sol (answers/writing/analysis/images) and
-- gpt-6-luna (background tracking) to llm-proxy-v2. When an override is set
-- here, the proxy substitutes it before forwarding to OpenAI, so the admin
-- can switch cost tiers without a code change or app update.

insert into public.app_settings (key, value, description) values
  (
    'llm_main_model',
    'gpt-6-sol',
    'Model used for live answers, deep answers, analysis, writing, and image reading. Must be a model allowed by llmguard.ts. Default: gpt-6-sol'
  ),
  (
    'llm_tracking_model',
    'gpt-6-luna',
    'Model used for background conversation tracking. Runs on every turn, so keep it cheap. Default: gpt-6-luna'
  )
on conflict (key) do nothing;
