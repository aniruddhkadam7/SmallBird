-- Remove retired plans completely. interview_sessions.plan_id is NOT NULL
-- and references plans, so past Interview Pass sessions are moved to
-- starter (the one-time pack that replaced it) before the delete.
update public.interview_sessions set plan_id = 'starter' where plan_id = 'interview-pass';

delete from public.plans
where id in ('interview-pass', 'power', 'pro-annual', 'pro-monthly')
  and is_active = false;
