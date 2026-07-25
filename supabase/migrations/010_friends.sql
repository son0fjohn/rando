-- 010: friends — encounter_complete (both sides tapped "we met in person")
-- is not by itself proof of an actual meeting; it's just two mutual button
-- taps, spoofable from anywhere. This migration adds a one-time, transient
-- GPS proximity check at confirm time: each confirm carries the device's
-- current raw coordinates — the ONLY place in this schema raw GPS ever
-- touches a server, existing solely to compare the two confirm-time
-- locations — and friendship is only created if both land within
-- FRIEND_RADIUS_M of each other. Coordinates are scrubbed immediately
-- after use. Per 006_encounter_confirms.sql's own note that "points/
-- friend-adding will consume encounter_complete later."

-- ---------- encounter_confirms: add transient location columns ----------
alter table public.encounter_confirms
  add column lat double precision,
  add column lng double precision;

-- ---------- haversine distance helper (mirrors client's presence.haversine
-- in backend.js, same formula) ----------
create or replace function public.haversine_meters(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision
language sql
immutable
as $$
  select 2 * 6371000 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2
  ));
$$;

-- ---------- friendships ----------
create table public.friendships (
  id         uuid primary key default gen_random_uuid(),
  user_a     uuid not null references auth.users (id) on delete cascade,
  user_b     uuid not null references auth.users (id) on delete cascade,
  match_id   uuid references public.matches (id) on delete set null, -- provenance only
  created_at timestamptz not null default now(),
  check (user_a < user_b),   -- DB-enforced canonical order, not just convention
  unique (user_a, user_b)
);

alter table public.friendships enable row level security;

create policy "participants read their friendships"
  on public.friendships for select
  using (auth.uid() in (user_a, user_b));
-- no insert/update/delete policies: created only by the trigger below
-- (SECURITY DEFINER), immutable thereafter. Unfriending is out of scope
-- for v1.

-- ---------- auto-friend on encounter_complete, gated by proximity ----------
create or replace function public.encounter_confirms_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  m     matches;
  a_lat double precision; a_lng double precision;
  b_lat double precision; b_lng double precision;
  dist  double precision;
begin
  -- lock the match row so the second confirm's read of encounter_confirms
  -- can't race the first confirm's still-uncommitted insert (the two
  -- confirms are separate rows under different PKs, so they don't
  -- naturally block each other without this — mirrors request_match's
  -- FOR UPDATE use for the same reason)
  select * into m from matches where id = new.match_id for update;
  if m.id is null then
    return new;
  end if;

  if (select count(*) from encounter_confirms where match_id = new.match_id) < 2 then
    return new;
  end if;

  select lat, lng into a_lat, a_lng
    from encounter_confirms where match_id = new.match_id and user_id = m.user_a;
  select lat, lng into b_lat, b_lng
    from encounter_confirms where match_id = new.match_id and user_id = m.user_b;

  if a_lat is not null and b_lat is not null then
    dist := haversine_meters(a_lat, a_lng, b_lat, b_lng);
    if dist <= 30 then -- FRIEND_RADIUS_M: "close enough" threshold, product decision
      insert into friendships (user_a, user_b, match_id)
      values (least(m.user_a, m.user_b), greatest(m.user_a, m.user_b), m.id)
      on conflict (user_a, user_b) do nothing;
    end if;
  end if;

  -- scrub: raw coordinates only ever exist to make this one comparison
  update encounter_confirms set lat = null, lng = null where match_id = new.match_id;

  return new;
end;
$$;

create trigger encounter_confirms_complete
  after insert on public.encounter_confirms
  for each row execute function public.encounter_confirms_complete();

-- ---------- encounter_status(): expose "verified" (=friended) separately
-- from merely "both tapped confirm" ----------
-- return type changes (2 cols -> 3), and Postgres cannot change a return
-- type via CREATE OR REPLACE: drop first, then re-grant below (drop loses
-- the 006 grants; REPLACE would have kept them, DROP+CREATE does not)
drop function if exists public.encounter_status(uuid);
create function public.encounter_status(p_match uuid)
returns table (i_confirmed boolean, encounter_complete boolean, encounter_verified boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from matches m
    where m.id = p_match and auth.uid() in (m.user_a, m.user_b)
  ) then
    raise exception 'not your match';
  end if;
  return query select
    exists (select 1 from encounter_confirms c
            where c.match_id = p_match and c.user_id = auth.uid()),
    (select count(*) = 2 from encounter_confirms c
     where c.match_id = p_match),
    exists (select 1 from friendships f where f.match_id = p_match);
end;
$$;

revoke all on function public.encounter_status(uuid) from public, anon;
grant execute on function public.encounter_status(uuid) to authenticated;

-- ---------- friend_messages (mirrors 005_messages.sql, no "active" gate) ----------
create table public.friend_messages (
  id            uuid primary key default gen_random_uuid(),
  friendship_id uuid not null references public.friendships (id) on delete cascade,
  sender        uuid not null references auth.users (id) on delete cascade,
  body          text not null check (char_length(body) between 1 and 2000),
  created_at    timestamptz not null default now()
);

create index friend_messages_friendship_created
  on public.friend_messages (friendship_id, created_at);

alter table public.friend_messages enable row level security;

create policy "participants read friend messages"
  on public.friend_messages for select
  using (
    exists (
      select 1 from friendships f
      where f.id = friendship_id and auth.uid() in (f.user_a, f.user_b)
    )
  );

create policy "participants send friend messages"
  on public.friend_messages for insert
  with check (
    sender = auth.uid()
    and exists (
      select 1 from friendships f
      where f.id = friendship_id and auth.uid() in (f.user_a, f.user_b)
    )
  );

alter publication supabase_realtime add table public.friend_messages;

-- ---------- list_friends() (mirrors get_world()'s SECURITY DEFINER read) ----------
create or replace function public.list_friends()
returns table (
  friendship_id uuid,
  friend_id     uuid,
  handle        text,
  avatar        jsonb,
  created_at    timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    f.id,
    case when f.user_a = auth.uid() then f.user_b else f.user_a end,
    p.handle,
    p.avatar,
    f.created_at
  from friendships f
  join profiles p
    on p.id = case when f.user_a = auth.uid() then f.user_b else f.user_a end
  where auth.uid() in (f.user_a, f.user_b)
  order by f.created_at desc;
$$;

revoke all on function public.list_friends() from public, anon;
grant execute on function public.list_friends() to authenticated;
