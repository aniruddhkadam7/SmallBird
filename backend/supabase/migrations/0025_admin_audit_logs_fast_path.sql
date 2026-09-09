-- Same single-round-trip pattern as 0023/0024, applied to admin_audit_logs
-- (also zero RLS policies, so it needed a matching RPC).
create function public.admin_list_audit_logs(
  p_target_user_id uuid default null,
  p_admin_user_id uuid default null,
  p_action text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id bigint, admin_user_id uuid, admin_email text, action text, target_user_id uuid,
  previous_value jsonb, new_value jsonb, reason text, metadata jsonb, created_at timestamptz, total_count bigint
)
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.* from (
    with base as (
      select l.id, l.admin_user_id, l.admin_email, l.action, l.target_user_id,
             l.previous_value, l.new_value, l.reason, l.metadata, l.created_at
      from public.admin_audit_logs l
    ),
    filtered as (
      select * from base
      where (p_target_user_id is null or target_user_id = p_target_user_id)
        and (p_admin_user_id is null or admin_user_id = p_admin_user_id)
        and (p_action is null or action = p_action)
    )
    select *, count(*) over () as total_count from filtered order by created_at desc limit p_limit offset p_offset
  ) f cross join _auth;
$$;

revoke all on function public.admin_list_audit_logs(uuid, uuid, text, int, int) from public, anon, authenticated;
grant execute on function public.admin_list_audit_logs(uuid, uuid, text, int, int) to authenticated, service_role;
