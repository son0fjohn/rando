-- 012: player reports, from the party room's profile card (web/profilecard.js).
-- Insert-only from clients: you can file a report about someone, never read,
-- change or delete one. Review goes through the dashboard / service role.
-- The reporter is always the signed-in user (default + check), so a client
-- can't file a report in someone else's name.

create table if not exists reports (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  reporter    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reported    uuid not null references auth.users (id) on delete cascade,
  reason      text not null check (reason in ('harassment', 'hateful', 'sexual', 'spam', 'something else')),
  context     jsonb not null default '{}'::jsonb   -- e.g. { "party": "ABCD" }; no message text
);

create index if not exists reports_reported_idx on reports (reported);

alter table reports enable row level security;

drop policy if exists reports_insert on reports;
create policy reports_insert on reports
  for insert to authenticated
  with check (reporter = auth.uid() and reported <> auth.uid());
