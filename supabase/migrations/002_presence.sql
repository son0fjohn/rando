-- 002: zones + presence — the spec's location safety model, literally.
--
-- Spec (World model / Safety architecture):
--  * Fixed set of coarse named zones; everyone in the same area shows at the
--    same shared marker (line 20). Zones are public reference data.
--  * ~15-min refresh, NOT user-triggerable more often (lines 21, 135):
--    enforced by a DB trigger, not client politeness.
--  * No per-identity location history (line 23): ONE row per user, updated
--    in place; going closed DELETES the row. No history table exists.
--  * Raw GPS: never stored anywhere in this schema — the client snaps
--    on-device and only ever transmits a zone_id (decision confirmed
--    2026-07-19). There is no column that could hold a coordinate.
--  * World view exposes avatars but never identity pre-match (line 130):
--    reads go through get_world(), which returns (zone, avatar) only.

-- ---------- zones: fixed reference data ----------
create table public.zones (
  id       text primary key,
  name     text not null,
  lat      double precision not null,  -- zone CENTER (public landmark), not a user location
  lng      double precision not null,
  marker_x numeric not null,           -- marker position on the world artwork, in %
  marker_y numeric not null
);

alter table public.zones enable row level security;

create policy "zones readable by signed-in users"
  on public.zones for select
  to authenticated
  using (true);
-- no insert/update/delete policies: the zone set changes only by migration

insert into public.zones (id, name, lat, lng, marker_x, marker_y) values
  ('itaewon-station', 'Itaewon Station', 37.5346, 126.9946, 50, 78),
  ('hamilton-alley',  'Hamilton Alley',  37.5349, 126.9941, 76, 68),
  ('gyeongnidan',     'Gyeongnidan',     37.5392, 126.9887, 30, 60),
  ('haebangchon',     'Haebangchon',     37.5418, 126.9882, 18, 47),
  ('noksapyeong',     'Noksapyeong',     37.5340, 126.9868, 63, 52),
  ('bogwang',         'Bogwang',         37.5289, 126.9944, 85, 44);

-- ---------- presence: current zone only, one row per open user ----------
create table public.presence (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  zone_id    text not null references public.zones (id),
  updated_at timestamptz not null default now()
);

alter table public.presence enable row level security;

-- you can only touch (and directly read) YOUR OWN row; everyone else's
-- presence is reachable solely through get_world(), which strips identity
create policy "read own presence"   on public.presence for select using (auth.uid() = user_id);
create policy "insert own presence" on public.presence for insert with check (auth.uid() = user_id);
create policy "update own presence" on public.presence for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own presence" on public.presence for delete using (auth.uid() = user_id);

-- server-enforced refresh interval (spec line 135) + server-owned timestamps
create or replace function public.enforce_presence_rules()
returns trigger
language plpgsql
as $$
begin
  -- timestamp is always server-set; clients cannot forge it
  new.updated_at := now();
  if tg_op = 'UPDATE'
     and new.zone_id is distinct from old.zone_id
     and old.updated_at > now() - interval '15 minutes' then
    raise exception 'zone refresh is limited to once per 15 minutes'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger presence_rules
  before insert or update on public.presence
  for each row execute function public.enforce_presence_rules();

-- note: DELETE is deliberately NOT rate-limited — going invisible is
-- always allowed instantly (safety property, not a courtesy)

-- ---------- the world read: avatars at zones, no identity ----------
-- Returns what the map needs and nothing else: which zones have people and
-- what those characters look like. No user_id, no handle, no timestamps.
-- Row order is randomized so ordering can't be used to correlate people
-- across polls. is_self lets your client skip double-rendering you.
create or replace function public.get_world()
returns table (zone_id text, avatar jsonb, is_self boolean)
language sql
security definer
set search_path = public
as $$
  select p.zone_id, pr.avatar, (p.user_id = auth.uid()) as is_self
  from presence p
  join profiles pr on pr.id = p.user_id
  where p.updated_at > now() - interval '45 minutes'
  order by random();
$$;

revoke all on function public.get_world() from public, anon;
grant execute on function public.get_world() to authenticated;
