-- Per UTC day, per user, per model usage_costs totals for admin-ai-usage.
--
-- usage_costs.estimated_cost_usd uses standard list prices, but OpenAI bills
-- the app's calls at the priority ("fast mode") rate, with cached input
-- cheaper and cache writes dearer -- so the estimate runs 25-50% low.
-- admin-ai-usage scales each day's rows by that day's real cost for the app's
-- OpenAI key (/v1/organization/costs buckets by UTC day, hence the grouping).

create or replace function public.admin_ai_usage_daily()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select coalesce(jsonb_agg(row), '[]'::jsonb) from (
    select jsonb_build_object(
      'day', (c.created_at at time zone 'utc')::date,
      'userId', c.user_id,
      'email', u.email,
      'model', c.model,
      'provider', c.provider,
      'calls', count(*),
      'totalTokens', sum(c.input_tokens + c.output_tokens),
      'estimatedCostUsd', coalesce(sum(c.estimated_cost_usd), 0)
    ) as row
    from public.usage_costs c
    left join auth.users u on u.id = c.user_id
    cross join _auth
    group by (c.created_at at time zone 'utc')::date, c.user_id, u.email, c.model, c.provider
  ) d;
$$;

revoke all on function public.admin_ai_usage_daily() from public, anon, authenticated;
grant execute on function public.admin_ai_usage_daily() to authenticated, service_role;
