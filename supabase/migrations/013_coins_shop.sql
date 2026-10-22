-- 013: coins (the earned currency, separate from any future paid gems) and
-- the cosmetics shop. Every balance, award and purchase lives here; the app
-- only calls the functions below and never writes a number itself.
--
-- How a party's coins are earned (web/party.js calls these):
--   * report_game: the party's host reports a COMPLETED game of the party's
--     current set (session id + set number + game 1..3) with each player's
--     finishing place. Games cut short are never reported.
--   * confirm_game: every player reports, from their own account, that they
--     played that game.
--   A player is paid for a game only when BOTH exist: the host's report
--   names them and they confirmed it themselves. So a host can't pay coins
--   into accounts that didn't play, and a player can't pay themselves.
--   * 1st / 2nd / 3rd earn 30 / 20 / 12; everyone else who finished, 5.
--   * the host of a set's 3rd game earns 50 when all 3 games are in and at
--     least 4 players were named in and confirmed every one of them.
-- Anti-farming:
--   * at most 300 coins earned per player per UTC day (awards are cut to fit)
--   * at most 3 host rewards per player per UTC day
--   * each (player, game) and each (host, set) pays once (unique index)
--   * a confirmation more than 30 minutes after the report pays nothing
-- The numbers are repeated in web/hpconfig.js (COINS) for labels only; THIS
-- file is the one that counts.

-- ------------------------------------------------------------------ tables
create table if not exists wallets (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  coins    integer not null default 0 check (coins >= 0)
);

create table if not exists coin_ledger (
  id         bigserial primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  delta      integer not null,
  reason     text not null check (reason in ('game', 'host', 'purchase')),
  session    text,
  set_no     integer,
  game_idx   integer,
  item       text,
  created_at timestamptz not null default now()
);
create index if not exists coin_ledger_user_day on coin_ledger (user_id, created_at);
-- each award happens once (purchases are guarded by the inventory instead)
create unique index if not exists coin_ledger_once on coin_ledger (user_id, reason, session, set_no, game_idx)
  where reason in ('game', 'host');

create table if not exists party_games (
  session    text not null check (length(session) between 8 and 64),
  set_no     integer not null check (set_no between 1 and 100),
  game_idx   integer not null check (game_idx between 1 and 3),
  game       text not null,
  host       uuid not null references auth.users (id) on delete cascade,
  ranking    jsonb not null,             -- [{ "id": uuid, "place": 1.. }]
  created_at timestamptz not null default now(),
  primary key (session, set_no, game_idx)
);

create table if not exists game_receipts (
  session    text not null,
  set_no     integer not null,
  game_idx   integer not null,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session, set_no, game_idx, user_id)
);

create table if not exists shop_items (
  id     text primary key,
  slot   text not null check (slot in ('hair', 'hairColor', 'top', 'bottom', 'shoes')),
  value  text not null,
  name   text not null,
  price  integer not null check (price > 0),
  unique (slot, value)
);

create table if not exists inventory (
  user_id    uuid not null references auth.users (id) on delete cascade,
  item       text not null references shop_items (id),
  created_at timestamptz not null default now(),
  primary key (user_id, item)
);

-- the first shop: a few existing cosmetics become shop items (everything
-- else stays free). Prices in coins.
insert into shop_items (id, slot, value, name, price) values
  ('top-hoodie-maroon',      'top',       'hoodie-maroon',       'maroon hoodie',      150),
  ('bottom-camo',            'bottom',    'camo',                'camo pants',         100),
  ('bottom-skirt-pleated',   'bottom',    'skirt-pleated-black', 'pleated skirt',      100),
  ('bottom-shorts-blue',     'bottom',    'shorts-blue',         'blue shorts',         60),
  ('shoes-clog-pink',        'shoes',     'clog-pink',           'pink clogs',          90),
  ('shoes-boot-work-tan',    'shoes',     'boot-work-tan',       'tan work boots',     120),
  ('haircolor-red',          'hairColor', 'red',                 'red hair dye',        80),
  ('haircolor-white',        'hairColor', 'white',               'white hair dye',      80)
on conflict (id) do nothing;

-- ------------------------------------------------------------------ RLS
-- read your own wallet, ledger and inventory; read the shop. No client
-- writes anywhere: only the security-definer functions below change them.
alter table wallets enable row level security;
alter table coin_ledger enable row level security;
alter table party_games enable row level security;
alter table game_receipts enable row level security;
alter table shop_items enable row level security;
alter table inventory enable row level security;

drop policy if exists wallets_own on wallets;
create policy wallets_own on wallets for select to authenticated using (user_id = auth.uid());
drop policy if exists ledger_own on coin_ledger;
create policy ledger_own on coin_ledger for select to authenticated using (user_id = auth.uid());
drop policy if exists inventory_own on inventory;
create policy inventory_own on inventory for select to authenticated using (user_id = auth.uid());
drop policy if exists shop_read on shop_items;
create policy shop_read on shop_items for select to authenticated using (true);
-- party_games / game_receipts: no client access at all

-- ------------------------------------------------------------------ internals
create or replace function _coins_for_place(p_place integer) returns integer
language sql immutable as $$
  select case p_place when 1 then 30 when 2 then 20 when 3 then 12 else 5 end
$$;

-- pay `amount` (cut to the daily cap); returns what was actually paid
create or replace function _earn(p_user uuid, p_amount integer, p_reason text, p_session text, p_set integer, p_idx integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  today   integer;
  pay     integer;
  n       integer;
begin
  select coalesce(sum(delta), 0) into today from coin_ledger
    where user_id = p_user and delta > 0 and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  pay := least(p_amount, 300 - today);
  if pay <= 0 then return 0; end if;
  insert into coin_ledger (user_id, delta, reason, session, set_no, game_idx)
    values (p_user, pay, p_reason, p_session, p_set, p_idx)
    on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return 0; end if;            -- already paid for this
  insert into wallets (user_id, coins) values (p_user, pay)
    on conflict (user_id) do update set coins = wallets.coins + excluded.coins;
  return pay;
end;
$$;

-- pay one player for one game, if the host's report and their confirmation
-- are both in (and the confirmation came within 30 minutes of the report)
create or replace function _settle(p_session text, p_set integer, p_idx integer, p_user uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  g      party_games%rowtype;
  r      game_receipts%rowtype;
  place  integer;
begin
  select * into g from party_games where session = p_session and set_no = p_set and game_idx = p_idx;
  if not found then return 0; end if;
  select * into r from game_receipts where session = p_session and set_no = p_set and game_idx = p_idx and user_id = p_user;
  if not found then return 0; end if;
  if r.created_at > g.created_at + interval '30 minutes' then return 0; end if;
  select (e->>'place')::integer into place from jsonb_array_elements(g.ranking) e where e->>'id' = p_user::text;
  if place is null then return 0; end if;
  return _earn(p_user, _coins_for_place(place), 'game', p_session, p_set, p_idx);
end;
$$;

-- the host reward: all 3 games in, 4+ players paid for every one of them
create or replace function _host_reward(p_session text, p_set integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  h       uuid;
  full_n  integer;
  hosted  integer;
begin
  if (select count(*) from party_games where session = p_session and set_no = p_set) < 3 then return 0; end if;
  select host into h from party_games where session = p_session and set_no = p_set and game_idx = 3;
  -- players named in all 3 reports who confirmed all 3 themselves (in time)
  select count(*) into full_n from (
    select r.user_id from game_receipts r
      join party_games g on g.session = r.session and g.set_no = r.set_no and g.game_idx = r.game_idx
      where r.session = p_session and r.set_no = p_set
        and r.created_at <= g.created_at + interval '30 minutes'
        and exists (select 1 from jsonb_array_elements(g.ranking) e where e->>'id' = r.user_id::text)
      group by r.user_id having count(*) = 3
  ) x;
  if full_n < 4 then return 0; end if;
  select count(*) into hosted from coin_ledger
    where user_id = h and reason = 'host' and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  if hosted >= 3 then return 0; end if;
  return _earn(h, 50, 'host', p_session, p_set, 0);
end;
$$;

-- ------------------------------------------------------------------ API
-- host: a completed game of the set. p_ranking: [{ "id": uuid, "place": n }]
create or replace function report_game(p_session text, p_set integer, p_idx integer, p_game text, p_ranking jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  n      integer;
  paid   integer := 0;
  u      record;
begin
  if me is null then raise exception 'sign in first'; end if;
  if p_game not in ('secretdiary', 'mission', 'ritual', 'artgallery', 'manhunt', 'sidequest') then raise exception 'unknown game'; end if;
  if jsonb_typeof(p_ranking) <> 'array' or jsonb_array_length(p_ranking) not between 2 and 12 then raise exception 'bad ranking'; end if;
  if exists (select 1 from jsonb_array_elements(p_ranking) e
             where (e->>'place') !~ '^[0-9]{1,2}$' or (e->>'place')::integer not between 1 and 12
                or (e->>'id') !~ '^[0-9a-f-]{36}$') then raise exception 'bad ranking'; end if;
  -- the host plays too, and games go in order
  if not exists (select 1 from jsonb_array_elements(p_ranking) e where e->>'id' = me::text) then raise exception 'the host must be in the game'; end if;
  if p_idx > 1 and not exists (select 1 from party_games where session = p_session and set_no = p_set and game_idx = p_idx - 1) then
    raise exception 'games go in order';
  end if;
  insert into party_games (session, set_no, game_idx, game, host, ranking)
    values (p_session, p_set, p_idx, p_game, me, p_ranking)
    on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return 0; end if;            -- already reported
  -- pay whoever already confirmed
  for u in select user_id from game_receipts where session = p_session and set_no = p_set and game_idx = p_idx loop
    paid := paid + _settle(p_session, p_set, p_idx, u.user_id);
  end loop;
  if p_idx = 3 then perform _host_reward(p_session, p_set); end if;
  return paid;
end;
$$;

-- player: I played this game. Returns the coins paid now (0 if the host's
-- report isn't in yet; it pays out when it arrives).
create or replace function confirm_game(p_session text, p_set integer, p_idx integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  me    uuid := auth.uid();
  paid  integer;
begin
  if me is null then raise exception 'sign in first'; end if;
  if p_idx not between 1 and 3 or p_set not between 1 and 100 or length(p_session) not between 8 and 64 then raise exception 'bad game'; end if;
  insert into game_receipts (session, set_no, game_idx, user_id) values (p_session, p_set, p_idx, me)
    on conflict do nothing;
  paid := _settle(p_session, p_set, p_idx, me);
  if p_idx = 3 then perform _host_reward(p_session, p_set); end if;
  return paid;
end;
$$;

-- what I earned in one set of a party (games + any host reward)
create or replace function my_party_coins(p_session text, p_set integer)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta), 0)::integer from coin_ledger
    where user_id = auth.uid() and session = p_session and set_no = p_set and reason in ('game', 'host')
$$;

-- my balance and what I own
create or replace function my_wallet()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'coins', coalesce((select coins from wallets where user_id = auth.uid()), 0),
    'owned', coalesce((select jsonb_agg(item) from inventory where user_id = auth.uid()), '[]'::jsonb))
$$;

-- buy a shop item: checks the price against the balance, takes the coins,
-- unlocks the item. All in one transaction, the wallet row locked.
create or replace function buy_item(p_item text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  it     shop_items%rowtype;
  have   integer;
begin
  if me is null then raise exception 'sign in first'; end if;
  select * into it from shop_items where id = p_item;
  if not found then raise exception 'no such item'; end if;
  if exists (select 1 from inventory where user_id = me and item = p_item) then
    return jsonb_build_object('ok', true, 'owned', true) || my_wallet();
  end if;
  insert into wallets (user_id, coins) values (me, 0) on conflict (user_id) do nothing;
  select coins into have from wallets where user_id = me for update;
  if have < it.price then
    return jsonb_build_object('ok', false, 'why', 'not enough coins', 'coins', have);
  end if;
  update wallets set coins = coins - it.price where user_id = me;
  insert into coin_ledger (user_id, delta, reason, item) values (me, -it.price, 'purchase', p_item);
  insert into inventory (user_id, item) values (me, p_item);
  return jsonb_build_object('ok', true) || my_wallet();
end;
$$;

revoke all on function _coins_for_place(integer), _earn(uuid, integer, text, text, integer, integer),
  _settle(text, integer, integer, uuid), _host_reward(text, integer) from public, anon, authenticated;
grant execute on function report_game(text, integer, integer, text, jsonb), confirm_game(text, integer, integer),
  my_party_coins(text, integer), my_wallet(), buy_item(text) to authenticated;

-- ------------------------------------------------------------------ the shop's lock
-- You can only CHANGE INTO a shop item you own. (Anyone already wearing one
-- when this ships keeps it until they change it.)
create or replace function _check_owned_cosmetics()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  it record;
begin
  for it in select s.* from shop_items s
            where (new.avatar->>s.slot) = s.value
              and (old.avatar->>s.slot) is distinct from s.value
              and not exists (select 1 from inventory i where i.user_id = new.id and i.item = s.id) loop
    raise exception 'locked: % is in the shop (% coins)', it.name, it.price;
  end loop;
  return new;
end;
$$;
drop trigger if exists profiles_owned_cosmetics on profiles;
create trigger profiles_owned_cosmetics before update of avatar on profiles
  for each row execute function _check_owned_cosmetics();
