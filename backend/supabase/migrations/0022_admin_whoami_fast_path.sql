-- Performance fix: requireAdmin() was making two sequential network round
-- trips per request -- one to GoTrue's /user endpoint (userClient.auth.
-- getUser(jwt)) to verify the caller's JWT, then a separate query against
-- admin_users. PostgREST already verifies the JWT's signature/expiry itself
-- (the same mechanism every RLS policy in this project already relies on
-- via auth.uid()) before it ever invokes an RPC -- so a single RPC call that
-- reads auth.uid() internally gets an equally-verified identity in one round
-- trip instead of two. This is not a security relaxation: the JWT is still
-- cryptographically verified, just by PostgREST's built-in verification
-- instead of a redundant manual call to the Auth server.
create function public.admin_whoami()
returns table (user_id uuid, email text)
language sql
security definer
set search_path = public
as $$
  select a.user_id, a.email
  from public.admin_users a
  where a.user_id = auth.uid();
$$;

-- Safe to grant to authenticated: it only ever answers "is the CALLER an
-- admin" (filtered to auth.uid() = a.user_id) -- it can't be used to
-- enumerate or learn anything about other admins. Postgres grants EXECUTE
-- to the PUBLIC pseudo-role by default on every new function (which anon
-- inherits too) -- revoke that explicitly rather than relying on
-- auth.uid() being null for anon to make it harmless.
revoke execute on function public.admin_whoami() from public;
grant execute on function public.admin_whoami() to authenticated;
