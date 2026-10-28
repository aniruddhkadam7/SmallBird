-- Resumes made with the website's resume builder (smallbird.in/resume/<id>).
-- `data` is the whole resume as JSON (name, contact lines, sections) in the
-- shape src/lib/resume/types.ts in SmallBird-website defines; the website
-- renders and prints it, nothing server-side reads inside it.
--
-- Same ownership pattern as interview_transcripts (0012): user_id defaults to
-- auth.uid() so the client never sends it, and every policy is scoped to the
-- caller's own rows. Unlike transcripts, a resume is the user's own draft, so
-- they can delete it.
create table if not exists public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'Untitled resume',
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists resumes_user_id_updated_at_idx
  on public.resumes (user_id, updated_at desc);

-- A resume is a few KB; this only stops a script from storing junk in bulk.
alter table public.resumes
  add constraint resumes_data_size check (pg_column_size(data) < 200000);

alter table public.resumes enable row level security;

create policy "resumes_select_own"
  on public.resumes for select
  using (auth.uid() = user_id);

create policy "resumes_insert_own"
  on public.resumes for insert
  with check (auth.uid() = user_id);

create policy "resumes_update_own"
  on public.resumes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "resumes_delete_own"
  on public.resumes for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.resumes to authenticated;
revoke all on public.resumes from anon;

create or replace function public.resumes_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger resumes_touch_updated_at
  before update on public.resumes
  for each row execute function public.resumes_touch_updated_at();

-- ---- Per-plan limits ------------------------------------------------------
-- How many resumes a user can keep and how many AI actions (resume-ai) they
-- get per day. Shown on the website's pricing cards from lib/plans.ts
-- RESUME_LIMITS — keep the two in step. max_resumes null = unlimited.
alter table public.plans
  add column if not exists max_resumes int,
  add column if not exists resume_ai_per_day int not null default 5;

update public.plans set max_resumes = 2,    resume_ai_per_day = 5   where id = 'free';
update public.plans set max_resumes = 5,    resume_ai_per_day = 20  where id = 'starter';
update public.plans set max_resumes = null, resume_ai_per_day = 40  where id = 'pro';
update public.plans set max_resumes = null, resume_ai_per_day = 100 where id = 'pro-plus';

-- Refuses a new resume past the plan's limit. Runs as the inserting user
-- (not security definer): RLS already lets them read their own entitlement,
-- the plans table and their own resumes, which is all this needs.
create or replace function public.resumes_enforce_plan_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_max int;
  v_count int;
begin
  select p.max_resumes into v_max
    from public.entitlements e
    join public.plans p on p.id = e.plan_id
   where e.user_id = new.user_id;

  if v_max is null then
    -- Unlimited plan, or no entitlement row (other checks handle that case).
    return new;
  end if;

  select count(*) into v_count from public.resumes where user_id = new.user_id;
  if v_count >= v_max then
    raise exception 'RESUME_LIMIT: your plan allows % saved resumes', v_max
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger resumes_enforce_plan_limit
  before insert on public.resumes
  for each row execute function public.resumes_enforce_plan_limit();
