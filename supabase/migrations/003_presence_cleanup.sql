-- 003 (optional but recommended): scheduled deletion of stale presence rows.
-- get_world() already filters rows older than 45 min, so stale rows are
-- never DISPLAYED either way — this job makes sure they're actually
-- DELETED too, upholding the spec's "no history beyond the current
-- session's zone display" as physical deletion, not just filtering.
create extension if not exists pg_cron;

select cron.schedule(
  'presence-cleanup',
  '*/15 * * * *',
  $$ delete from public.presence where updated_at < now() - interval '45 minutes' $$
);
