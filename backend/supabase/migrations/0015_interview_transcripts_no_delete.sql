-- Interview transcripts must never be deletable: a completed interview's
-- record is the whole point of the dashboard history feature, and the
-- previous `interview_transcripts_delete_own` policy let any signed-in user
-- (via the desktop app's own access token, or a direct PostgREST/Supabase JS
-- call from the website) permanently erase their own rows. Dropping the
-- policy is not enough by itself -- RLS policies only apply to roles that
-- otherwise have the underlying SQL privilege, so the explicit `revoke`
-- below is what actually removes the capability rather than just leaving it
-- ungated for a future policy to accidentally re-enable.
drop policy if exists "interview_transcripts_delete_own" on public.interview_transcripts;

revoke delete on public.interview_transcripts from authenticated;
revoke delete on public.interview_transcripts from anon;

-- Needed for the desktop app's move to saving progress incrementally
-- (upserting the same session id after every completed turn, and once more
-- on close) instead of a single insert at the end -- see
-- src-tauri/src/history.rs's `save_interview_session`. Scoped identically to
-- the existing insert/select policies: a row can only ever be updated by the
-- same user who owns it, and `with check` stops that update from ever
-- reassigning `user_id` to someone else.
create policy "interview_transcripts_update_own"
  on public.interview_transcripts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
