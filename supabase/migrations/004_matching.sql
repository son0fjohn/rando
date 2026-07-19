-- 004: matching — two open users in the same zone, paired server-side.
--
-- Model (confirmed 2026-07-19): being open makes you visible; a separate
-- explicit "match me" tap enters the queue. The backend pairs two queued
-- users in the same zone — no browsing, no picking from a list (spec
-- line 44: proximity handled invisibly on the backend).
-- Mutual reveal only (line 130): profiles become visible to each other
-- ONLY once a match exists.

-- ---------- queue ----------
create table public.match_queue (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  zone_id    text not null references public.zones (id),
  created_at timestamptz not null default now()
);

alter table public.match_queue enable row level security;

create policy "read own queue entry"
  on public.match_queue for select using (auth.uid() = user_id);
create policy "leave queue"
  on public.match_queue for delete using (auth.uid() = user_id);
-- no insert/update policies: you enter the queue only via request_match(),
-- which derives your zone from your presence row server-side

-- ---------- matches ----------
create table public.matches (
  id         uuid primary key default gen_random_uuid(),
  user_a     uuid not null references auth.users (id) on delete cascade,
  user_b     uuid not null references auth.users (id) on delete cascade,
  zone_id    text not null references public.zones (id),
  status     text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  check (user_a <> user_b)
);

alter table public.matches enable row level security;

create policy "participants read their matches"
  on public.matches for select
  using (auth.uid() in (user_a, user_b));

-- participants may close a match; nothing else is client-writable
create policy "participants close their matches"
  on public.matches for update
  using (auth.uid() in (user_a, user_b))
  with check (auth.uid() in (user_a, user_b) and status = 'closed');

-- ---------- pairing (atomic, race-safe) ----------
create or replace function public.request_match()
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  my_zone text;
  partner uuid;
  m matches;
begin
  -- you must be open; your queue zone is YOUR presence zone, not an argument
  select zone_id into my_zone from presence where user_id = auth.uid();
  if my_zone is null then
    raise exception 'you must be open to match';
  end if;
  if exists (select 1 from matches
             where status = 'active' and auth.uid() in (user_a, user_b)) then
    raise exception 'you already have an active match';
  end if;

  -- oldest waiting user in my zone; SKIP LOCKED prevents double-pairing
  select user_id into partner
  from match_queue
  where zone_id = my_zone and user_id <> auth.uid()
  order by created_at
  for update skip locked
  limit 1;

  if partner is null then
    insert into match_queue (user_id, zone_id)
    values (auth.uid(), my_zone)
    on conflict (user_id) do update
      set zone_id = excluded.zone_id, created_at = now();
    return null; -- waiting
  end if;

  delete from match_queue where user_id in (partner, auth.uid());
  insert into matches (user_a, user_b, zone_id)
  values (partner, auth.uid(), my_zone)
  returning * into m;
  return m;
end;
$$;

revoke all on function public.request_match() from public, anon;
grant execute on function public.request_match() to authenticated;

-- ---------- queue hygiene ----------
-- going invisible or changing zone silently drops you from the queue
create or replace function public.presence_queue_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from match_queue where user_id = old.user_id;
    return old;
  end if;
  if new.zone_id is distinct from old.zone_id then
    delete from match_queue where user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger presence_queue_sync
  after update or delete on public.presence
  for each row execute function public.presence_queue_sync();

-- ---------- mutual reveal (spec line 130) ----------
-- the ONLY way to see another profile: you two are matched
create policy "matched users see each other"
  on public.profiles for select
  using (
    exists (
      select 1 from matches m
      where (m.user_a = profiles.id and m.user_b = auth.uid())
         or (m.user_b = profiles.id and m.user_a = auth.uid())
    )
  );
