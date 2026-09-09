-- Bug: the free-trial minute grant in handle_new_user_entitlement() is
-- guarded only by `on conflict (user_id) do nothing` against
-- public.entitlements, whose row is destroyed (ON DELETE CASCADE) the
-- moment the underlying auth.users row is deleted. Supabase Auth mints a
-- brand-new UUID for every signup, so deleting an account and signing back
-- up with the SAME EMAIL creates a fresh auth.users.id with no matching
-- entitlements row — the trigger then grants a full new "free" trial as if
-- it were the very first time, even though nothing in the schema was
-- keyed on anything that survives the deletion (entitlements,
-- entitlement_ledger and profiles are all FK'd to auth.users(id) with
-- CASCADE).
--
-- Fix: track trial grants in a table keyed on email — the one identity
-- that's stable across "delete account, sign up again" — which does NOT
-- cascade when the auth.users row is removed, so a re-signup under the
-- same email is recognized and no second trial is handed out.

create table if not exists public.trial_grants (
  email text primary key,
  user_id uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now()
);

alter table public.trial_grants enable row level security;
-- No policies: this table is only ever touched by the SECURITY DEFINER
-- trigger function below, running as its owner — never directly by
-- anon/authenticated/service_role callers.

-- Backfill from existing accounts' signup-grant history so an account that
-- gets deleted starting today can't come back for a second trial either.
insert into public.trial_grants (email, user_id, granted_at)
select lower(u.email), u.id, min(el.created_at)
from auth.users u
join public.entitlement_ledger el on el.user_id = u.id and el.source = 'SIGNUP_GRANT'
where u.email is not null
group by u.id, u.email
on conflict (email) do nothing;

create or replace function public.handle_new_user_entitlement()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_minutes numeric;
  v_email text := case when new.email is not null then lower(new.email) end;
  v_already_granted boolean := false;
begin
  if v_email is not null then
    select exists(select 1 from public.trial_grants where email = v_email) into v_already_granted;
  end if;

  if v_already_granted then
    -- This email already received a free trial under a previous account
    -- (most commonly: deleted and signed up again). Still create an
    -- entitlements row — requireEntitlement() in the edge functions treats
    -- a missing row as a hard 403 for every user, not just abusers — but
    -- with no free minutes attached.
    insert into public.entitlements (user_id, plan_id, remaining_minutes)
    values (new.id, 'free', 0)
    on conflict (user_id) do nothing;
    return new;
  end if;

  select included_minutes into v_minutes from public.plans where id = 'free';

  insert into public.entitlements (user_id, plan_id, remaining_minutes)
  values (new.id, 'free', v_minutes)
  on conflict (user_id) do nothing;

  if found then
    insert into public.entitlement_ledger (user_id, delta, balance_before, balance_after, source)
    values (new.id, v_minutes, 0, v_minutes, 'SIGNUP_GRANT');

    if v_email is not null then
      insert into public.trial_grants (email, user_id)
      values (v_email, new.id)
      on conflict (email) do nothing;
    end if;
  end if;

  return new;
end;
$function$;
