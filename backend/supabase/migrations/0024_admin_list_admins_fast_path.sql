-- Same single-round-trip pattern as 0023, applied to the admin allowlist
-- read (admin_users has zero RLS policies, so it needed a matching RPC
-- rather than a direct .from() query once admin-list-admins moved off the
-- service-role client).
create function public.admin_list_all_admins()
returns table (user_id uuid, email text, role text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  with _auth as (select public.current_admin_user_id())
  select f.* from (
    select a.user_id, a.email, a.role, a.created_at
    from public.admin_users a
    order by a.created_at asc
  ) f cross join _auth;
$$;

revoke all on function public.admin_list_all_admins() from public, anon, authenticated;
grant execute on function public.admin_list_all_admins() to authenticated, service_role;
