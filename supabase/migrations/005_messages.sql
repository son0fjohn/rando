-- 005: messages — real persisted chat between matched accounts.
-- Readable/writable ONLY by the two match participants; sending requires
-- the match to still be active. Messages are immutable (no update/delete
-- policies). Realtime delivery via the supabase_realtime publication;
-- Postgres Changes subscriptions respect these same RLS policies, so a
-- third account cannot subscribe its way into someone else's thread.

create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches (id) on delete cascade,
  sender     uuid not null references auth.users (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index messages_match_created on public.messages (match_id, created_at);

alter table public.messages enable row level security;

create policy "participants read match messages"
  on public.messages for select
  using (
    exists (
      select 1 from matches m
      where m.id = match_id and auth.uid() in (m.user_a, m.user_b)
    )
  );

create policy "participants send in active match"
  on public.messages for insert
  with check (
    sender = auth.uid()
    and exists (
      select 1 from matches m
      where m.id = match_id
        and m.status = 'active'
        and auth.uid() in (m.user_a, m.user_b)
    )
  );

alter publication supabase_realtime add table public.messages;
