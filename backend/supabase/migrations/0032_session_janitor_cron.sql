-- Runs the session-janitor Edge Function every minute: revokes the Deepgram
-- keys of sessions that ended without usage-report doing it (crashed /
-- killed / offline apps, or a revocation that failed the first time).
-- Apply only after session-janitor is deployed.
--
-- The anon key below is the public one the desktop app already ships with;
-- the janitor only ever revokes keys of already-ended sessions.

create extension if not exists pg_net;

select cron.schedule(
  'session-janitor',
  '* * * * *',
  $$select net.http_post(
      url := 'https://xubbwgrjvvsbfvxcuzav.supabase.co/functions/v1/session-janitor',
      headers := '{"content-type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1YmJ3Z3JqdnZzYmZ2eGN1emF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NzQ5NjAsImV4cCI6MjEwMjQ1MDk2MH0.ZBkDqETqfJFcrmx68wQCqE2RsfvDwyy_k7uJvlY3vJo"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 20000
    )$$
);
