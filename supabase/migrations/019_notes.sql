-- 019: Notes on the map. Short notes anywhere public (the feel of Elden
-- Ring's messages): a line of text, a photo, or a meme, pinned to a ~20 m
-- square of the street. Found on the map from anywhere, opened only within
-- 80 m. Votes change how long a note lives; enough of them make it a
-- permanent landmark. See docs/notes.md. Client: web/notes.js (+ notegeo.js,
-- notefilter.js, noteimage.js); the image check: supabase/functions/moderate-note.
--
-- Privacy (AGENTS.md):
--   * a note's position is stored snapped to the 20 m grid (note_snap_*,
--     the same maths as web/notegeo.js snap()), never the author's GPS point;
--     the phone snaps before sending and the server snaps again
--   * a reader's position reaches open / vote / react / report already
--     snapped by the phone; it is snapped again, used for the 80 m check and
--     forgotten: nothing about it is stored, logged or returned
--   * markers come from a box (the visible map), never "near me"
--   * the author is stored (for the daily limit, bans and coins) and never
--     returned to anyone: every function here returns `mine` at most
--   * a photo / meme stays `pending` (only its author sees it) until the
--     moderation function passes it; a reported note is hidden at once, for
--     everyone, until an admin reviews it
-- Nothing here is writable by clients: every change goes through a
-- security definer function that checks the caller.
--
-- The numbers (web/notegeo.js NOTE_RULES repeats them for labels only):
--   life        7 days (10 at a spot), ±1 day per weighted net vote, never
--               past now (a note voted under now is gone)
--   landmark    weighted net >= 25 (spot notes: net × 1.25), then permanent
--   trust       a vote weighs 1.0; 2.0 from a verified account older than 30
--               days with 3+ confirmed games, 1.5 verified and 30+ days; 0.5
--               under 3 days old; 0 with an upheld report (a removed note)
--               or a ban. Server-side only, never shown per voter.
--   limit       5 notes per player per UTC day
--   coins       the author: 1 coin per 5 weighted net upvotes (each step
--               once), at most 10 a day, verified authors only, inside the
--               300 a day cap of 013; nobody can vote on their own note
--   spots       a note within 60 m of a known spot (note_spots: the NPC
--               venues of world3d.js and web/data/heroes.json)
--
-- Apply: python3 scripts/apply_migration.py supabase/migrations/019_notes.sql
-- (after 013 and 017/018). Then deploy the moderation function and set its
-- key: docs/notes.md.

-- ------------------------------------------------------------------ the snap grid and distances
-- rows of 20 m from the equator; columns of 20 m along the row's latitude
create or replace function note_snap_lat(p_lat float8) returns float8
language sql immutable as $$
  select round(((floor(p_lat / (20.0::float8 / 110540)) + 0.5) * (20.0::float8 / 110540))::numeric, 6)::float8
$$;
create or replace function note_snap_lng(p_slat float8, p_lng float8) returns float8
language sql immutable as $$
  select round(((floor(p_lng / (20.0::float8 / (111320 * cos(radians(p_slat))))) + 0.5)
               * (20.0::float8 / (111320 * cos(radians(p_slat)))))::numeric, 6)::float8
$$;
-- metres between two spots (the app's flat-earth metres)
create or replace function note_dist(a_lat float8, a_lng float8, b_lat float8, b_lng float8) returns float8
language sql immutable as $$
  select sqrt(((a_lat - b_lat) * 110540) ^ 2 + ((a_lng - b_lng) * 111320 * cos(radians((a_lat + b_lat) / 2))) ^ 2)
$$;

-- ------------------------------------------------------------------ tables
-- the places the app knows (web/notegeo.js NOTE_SPOTS; test/notes_sql.mjs checks they match)
create table if not exists note_spots (
  id    text primary key,
  name  text not null,
  lat   float8 not null,
  lng   float8 not null
);
insert into note_spots (id, name, lat, lng) values
  ('arch-chill', 'Ikovox Cafe', 37.5349347, 126.9920648),
  ('arch-chaos', 'Grand Ole Opry', 37.534086, 126.996588),
  ('arch-sporty', 'Namsan 산스장', 37.5496508, 126.9933311),
  ('hamilton-hotel', 'Hamilton Hotel', 37.534673, 126.994076),
  ('itaewon-crossing-east', 'Itaewon Crossing', 37.53455, 126.99465),
  ('itaewon-station', 'Itaewon Station', 37.534473, 126.993752),
  ('grand-ole-opry', 'Grand Ole Opry', 37.534086, 126.996588),
  ('jacks-bar', 'Jack''s Bar', 37.535095, 126.992379),
  ('soap', 'Soap', 37.533878, 126.99492),
  ('danco', 'Danco', 37.534967, 126.994581),
  ('waikiki', 'Waikiki', 37.534966, 126.994781),
  ('agave', 'Agave', 37.53506, 126.994291),
  ('waikiki-beach-pub', 'Waikiki Beach Pub', 37.534855, 126.993249),
  ('bolero', 'Bolero', 37.534805, 126.9985),
  ('grainhaus', 'Grainhaus', 37.533733, 126.99602),
  ('lotte-world-tower', 'Lotte World Tower', 37.512559, 127.102543),
  ('n-seoul-tower', 'N Seoul Tower', 37.551169, 126.988227),
  ('coex', 'COEX', 37.5116, 127.059),
  ('gangnam-station', 'Gangnam Station', 37.497942, 127.027621),
  ('calgary-tower', 'Calgary Tower', 51.044344, -114.063123),
  ('muttart-conservatory', 'Muttart Conservatory', 53.535694, -113.477306),
  ('rogers-place', 'Rogers Place', 53.546944, -113.497778)
on conflict (id) do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng;

-- the slur lists (web/notefilter.js SLUR_WORDS = whole tokens, SLUR_STEMS = inside squashed text)
create table if not exists note_slurs (
  word  text not null,
  stem  boolean not null default false,
  primary key (word, stem)
);
insert into note_slurs (word, stem) values
  ('fag', false), ('faggot', false), ('dyke', false), ('tranny', false), ('shemale', false), ('retard', false), ('spic', false), ('spick', false),
  ('kike', false), ('chink', false), ('gook', false), ('wetback', false), ('coon', false), ('raghead', false), ('towelhead', false), ('beaner', false),
  ('paki', false), ('nigga', false), ('nigger', false), ('jap', false), ('gypo', false), ('gyppo', false), ('짱깨', false), ('짱개', false),
  ('쪽바리', false), ('쪽발이', false), ('조센징', false), ('깜둥이', false), ('흑형', false), ('똥남아', false), ('틀딱', false), ('한남충', false),
  ('김치녀', false), ('된장녀', false), ('맘충', false), ('똥꼬충', false), ('병신', false), ('정신병자', false), ('니거', false),
  ('nigger', true), ('nigga', true), ('faggot', true), ('tranny', true), ('towelhead', true), ('raghead', true), ('wetback', true), ('shemale', true),
  ('짱깨', true), ('짱개', true), ('쪽바리', true), ('쪽발이', true), ('조센징', true), ('깜둥이', true), ('흑형', true), ('똥남아', true),
  ('틀딱', true), ('한남충', true), ('김치녀', true), ('된장녀', true), ('똥꼬충', true), ('병신', true)
on conflict do nothing;

create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  author      uuid not null references auth.users (id) on delete cascade,   -- never returned to clients
  kind        text not null check (kind in ('text', 'photo', 'meme')),
  body        text check (body is null or char_length(body) <= 200),
  cap_top     text check (cap_top is null or char_length(cap_top) <= 60),
  cap_bottom  text check (cap_bottom is null or char_length(cap_bottom) <= 60),
  image       text check (image is null or image ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'),
  image_state text not null default 'none' check (image_state in ('none', 'pending', 'approved', 'rejected')),
  lat         float8 not null,            -- snapped to the 20 m grid
  lng         float8 not null,
  spot        text references note_spots (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  landmark    boolean not null default false,
  wup         numeric(10, 2) not null default 0,     -- trust-weighted up / down votes
  wdown       numeric(10, 2) not null default 0,
  agree       integer not null default 0,
  disagree    integer not null default 0,
  views       integer not null default 0,
  paid_steps  integer not null default 0,            -- coin steps (5 weighted net upvotes each) already paid
  status      text not null default 'live' check (status in ('live', 'reported', 'removed', 'restored'))
);
create index if not exists notes_where on notes (lat, lng);
create index if not exists notes_author_day on notes (author, created_at);

create table if not exists note_votes (
  note     uuid not null references notes (id) on delete cascade,
  user_id  uuid not null references auth.users (id) on delete cascade,
  v        smallint not null check (v in (-1, 1)),
  w        numeric(4, 2) not null,                   -- the voter's trust when they voted
  at       timestamptz not null default now(),
  primary key (note, user_id)
);
create table if not exists note_reacts (
  note     uuid not null references notes (id) on delete cascade,
  user_id  uuid not null references auth.users (id) on delete cascade,
  r        smallint not null check (r in (-1, 1)),   -- agree / disagree
  primary key (note, user_id)
);
create table if not exists note_views (
  note     uuid not null references notes (id) on delete cascade,
  user_id  uuid not null references auth.users (id) on delete cascade,
  primary key (note, user_id)
);
-- a report carries no message text; the reporter is kept so false reporting can be caught
create table if not exists note_reports (
  note        uuid not null references notes (id) on delete cascade,
  reporter    uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (note, reporter)
);
create index if not exists note_reports_day on note_reports (reporter, created_at);
-- repeat offenders: no more notes, no vote weight
create table if not exists note_bans (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  reason      text,
  created_at  timestamptz not null default now(),
  until       timestamptz                              -- null: for good
);

-- coins for notes ride on 013's ledger
alter table coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table coin_ledger add constraint coin_ledger_reason_check check (reason in ('game', 'host', 'purchase', 'note'));

-- ------------------------------------------------------------------ RLS: no client access to any of it
alter table note_spots enable row level security;
alter table note_slurs enable row level security;
alter table notes enable row level security;
alter table note_votes enable row level security;
alter table note_reacts enable row level security;
alter table note_views enable row level security;
alter table note_reports enable row level security;
alter table note_bans enable row level security;
revoke all on note_spots, note_slurs, notes, note_votes, note_reacts, note_views, note_reports, note_bans from anon, authenticated;

-- ------------------------------------------------------------------ the text filter (the authority for phone / email / slurs)
-- The same steps as web/notefilter.js serverProblem(): NFKC, no zero-width
-- characters, ASCII lower case; phone and email patterns; then leetspeak
-- undone, 3+ repeats cut to 2, whole-token slurs (and plurals), and the
-- unmistakable ones inside the squashed text.
create or replace function note_text_problem(p_text text) returns text
language plpgsql stable set search_path = public as $$
declare
  b   text;
  l   text;
  sq  text;
begin
  if p_text is null or btrim(p_text) = '' then return null; end if;
  b := regexp_replace(normalize(p_text, NFKC), '[\u00AD\u200B-\u200F\u2060\uFEFF]', '', 'g');
  b := translate(b, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
  if b ~ '[0-9]([[:space:].()+/-]{0,2}[0-9]){8,}' then return 'phone'; end if;
  if b ~ '[a-z0-9._%+-]+[[:space:]]?(@|\(at\)|\[at\])[[:space:]]?[a-z0-9-]+([[:space:]]?(\.|\(dot\)|\[dot\])[[:space:]]?[a-z0-9-]+)+' then return 'email'; end if;
  l := translate(b, '013457@$!', 'oieastasi');
  sq := regexp_replace(regexp_replace(l, '[^a-z가-힣ㄱ-ㅎㅏ-ㅣ]+', '', 'g'), '(.)\1{2,}', '\1\1', 'g');
  l := regexp_replace(l, '(.)\1{2,}', '\1\1', 'g');
  if exists (select 1 from unnest(regexp_split_to_array(l, '[^a-z가-힣ㄱ-ㅎㅏ-ㅣ]+')) t(w)
             join note_slurs s on not s.stem and (t.w = s.word or t.w = s.word || 's' or t.w = s.word || 'es')) then
    return 'slur';
  end if;
  if exists (select 1 from note_slurs s where s.stem and position(s.word in sq) > 0) then return 'slur'; end if;
  return null;
end;
$$;

-- ------------------------------------------------------------------ internals
create or replace function _note_verified(p_user uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.users u where u.id = p_user and u.phone_confirmed_at is not null)
      or exists (select 1 from auth.identities i where i.user_id = p_user and i.provider = 'kakao')
$$;

create or replace function _note_banned(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from note_bans where user_id = p_user and (until is null or until > now()))
$$;

-- how much this player's vote weighs (server-side only, never shown per voter)
create or replace function _note_trust(p_user uuid) returns numeric
language plpgsql stable security definer set search_path = public, auth as $$
declare
  age    interval;
  games  integer;
begin
  if _note_banned(p_user) or exists (select 1 from notes where author = p_user and status = 'removed') then return 0; end if;
  select now() - created_at into age from auth.users where id = p_user;
  if age is null or age < interval '3 days' then return 0.5; end if;
  if age >= interval '30 days' and _note_verified(p_user) then
    select count(*) into games from game_receipts where user_id = p_user;
    return case when games >= 3 then 2.0 else 1.5 end;
  end if;
  return 1.0;
end;
$$;

-- may `me` see this note at all (a marker, opening it)?
create or replace function _note_visible(n notes, me uuid) returns boolean
language sql stable as $$
  select n.status in ('live', 'restored')
     and (n.landmark or n.expires_at > now())
     and (n.image_state in ('none', 'approved') or n.author = me)
$$;

-- the author's coins for a note's upvotes: capped at 10 a day (and 013's 300)
create or replace function _note_pay(p_user uuid, p_note uuid, p_amount integer) returns integer
language plpgsql security definer set search_path = public as $$
declare
  day0   timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  notes_today  integer;
  all_today    integer;
  pay    integer;
begin
  if p_amount <= 0 or not _note_verified(p_user) or _note_banned(p_user) then return 0; end if;
  select coalesce(sum(delta), 0) into notes_today from coin_ledger where user_id = p_user and reason = 'note' and created_at >= day0;
  select coalesce(sum(delta), 0) into all_today from coin_ledger where user_id = p_user and delta > 0 and created_at >= day0;
  pay := least(p_amount, 10 - notes_today, 300 - all_today);
  if pay <= 0 then return 0; end if;
  insert into coin_ledger (user_id, delta, reason, item) values (p_user, pay, 'note', p_note::text);
  insert into wallets (user_id, coins) values (p_user, pay)
    on conflict (user_id) do update set coins = wallets.coins + excluded.coins;
  return pay;
end;
$$;

-- totals, life, landmark and coins, from the votes as they stand
create or replace function _note_recount(p_note uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  n      notes%rowtype;
  up     numeric;
  down   numeric;
  net    numeric;
  steps  integer;
begin
  select coalesce(sum(w) filter (where v = 1), 0), coalesce(sum(w) filter (where v = -1), 0) into up, down from note_votes where note = p_note;
  update notes set wup = up, wdown = down,
    agree = (select count(*) from note_reacts where note = p_note and r = 1),
    disagree = (select count(*) from note_reacts where note = p_note and r = -1)
    where id = p_note returning * into n;
  net := up - down;
  update notes set
    expires_at = greatest(now(), n.created_at + ((case when n.spot is null then 7 else 10 end) + net) * interval '1 day'),
    landmark = n.landmark or net * (case when n.spot is null then 1 else 1.25 end) >= 25
    where id = p_note;
  steps := greatest(0, floor(net / 5))::integer;
  if steps > n.paid_steps then
    update notes set paid_steps = steps where id = p_note;     -- each step pays once, even if the cap ate it
    perform _note_pay(n.author, p_note, steps - n.paid_steps);
  end if;
end;
$$;

-- what an opened note shows (never the author)
create or replace function _note_card(n notes, me uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ok', true, 'id', n.id, 'kind', n.kind, 'body', n.body, 'top', n.cap_top, 'bottom', n.cap_bottom,
    -- the picture: the public copy, named after the note (the upload's path
    -- has the author's id in it, so only the author ever gets that one)
    'image', case when n.image_state = 'approved' then n.id::text || '.jpg' end,
    'upload', case when n.author = me then n.image end,
    'image_state', case when n.author = me then n.image_state else null end,
    'lat', n.lat, 'lng', n.lng, 'created_at', n.created_at, 'expires_at', n.expires_at, 'landmark', n.landmark,
    'spot', (select name from note_spots where id = n.spot),
    'score', round(n.wup - n.wdown)::integer, 'agree', n.agree, 'disagree', n.disagree, 'views', n.views,
    'my_vote', (select v from note_votes where note = n.id and user_id = me),
    'my_react', (select r from note_reacts where note = n.id and user_id = me),
    'mine', n.author = me)
$$;

-- the caller's snapped position against a note: may they act on it?
create or replace function _note_near(n notes, p_lat float8, p_lng float8) returns boolean
language plpgsql immutable as $$
declare
  rlat float8;
begin
  if p_lat is null or p_lng is null or abs(p_lat) > 85 or abs(p_lng) > 180 then return false; end if;
  rlat := note_snap_lat(p_lat);
  return note_dist(rlat, note_snap_lng(rlat, p_lng), n.lat, n.lng) <= 80;
end;
$$;

-- ------------------------------------------------------------------ API
-- the markers in a box (the visible map). Never "near me".
create or replace function notes_in_box(p_s float8, p_w float8, p_n float8, p_e float8)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'sign in first'; end if;
  if p_n < p_s or p_e < p_w or p_n - p_s > 0.2 or p_e - p_w > 0.25 then raise exception 'bad box'; end if;
  return coalesce((select jsonb_agg(m) from (
    select jsonb_build_object('id', n.id, 'kind', n.kind, 'lat', n.lat, 'lng', n.lng, 'landmark', n.landmark, 'spot', n.spot,
             'mine', n.author = me, 'state', case when n.author = me and n.image_state in ('pending', 'rejected') then n.image_state end) m
      from notes n
      where n.lat between p_s and p_n and n.lng between p_w and p_e and _note_visible(n, me)
      order by n.landmark desc, n.created_at desc
      limit 300) x), '[]'::jsonb);
end;
$$;

-- the spots (for the map's hubs)
create or replace function note_spot_list()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'lat', lat, 'lng', lng)), '[]'::jsonb) from note_spots
$$;

-- how many notes I can still leave today
create or replace function my_notes_left()
returns integer language sql stable security definer set search_path = public as $$
  select greatest(0, 5 - (select count(*) from notes where author = auth.uid()
    and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'))::integer
$$;

-- leave a note at the caller's (phone-snapped) position. Text: p_body. A
-- photo: p_image (+ an optional p_body). A meme: p_image + p_top / p_bottom.
-- p_image is the caller's own upload: '<their id>/<uuid>.jpg' in the private
-- note-uploads bucket, already stripped of metadata on the phone.
create or replace function leave_note(p_lat float8, p_lng float8, p_kind text, p_body text default null,
                                      p_top text default null, p_bottom text default null, p_image text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me    uuid := auth.uid();
  slat  float8;
  slng  float8;
  sp    note_spots%rowtype;
  why   text;
  today integer;
  n     notes%rowtype;
begin
  if me is null then raise exception 'sign in first'; end if;
  if _note_banned(me) then return jsonb_build_object('ok', false, 'why', 'banned'); end if;
  if not _note_verified(me) then return jsonb_build_object('ok', false, 'why', 'verify'); end if;
  if p_kind not in ('text', 'photo', 'meme') then raise exception 'bad kind'; end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 85 or abs(p_lng) > 180 then raise exception 'bad position'; end if;
  p_body := nullif(btrim(p_body), ''); p_top := nullif(btrim(p_top), ''); p_bottom := nullif(btrim(p_bottom), '');
  if p_kind = 'text' and (p_body is null or p_image is not null or p_top is not null or p_bottom is not null) then raise exception 'bad note'; end if;
  if p_kind <> 'text' and (p_image is null or p_image !~ ('^' || me::text || '/[0-9a-f-]{36}\.jpg$')) then raise exception 'bad image'; end if;
  if p_kind = 'photo' and (p_top is not null or p_bottom is not null) then raise exception 'bad note'; end if;
  if p_kind = 'meme' and p_body is not null then raise exception 'bad note'; end if;
  if char_length(coalesce(p_body, '')) > 200 or char_length(coalesce(p_top, '')) > 60 or char_length(coalesce(p_bottom, '')) > 60 then
    return jsonb_build_object('ok', false, 'why', 'long');
  end if;
  why := coalesce(note_text_problem(p_body), note_text_problem(p_top), note_text_problem(p_bottom));
  if why is not null then return jsonb_build_object('ok', false, 'why', why); end if;
  -- 5 a day (a lock on the author's row keeps two at once from both getting the 5th)
  perform pg_advisory_xact_lock(hashtext('notes:' || me::text));
  select count(*) into today from notes where author = me and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  if today >= 5 then return jsonb_build_object('ok', false, 'why', 'limit', 'left', 0); end if;
  -- snapped again here, whatever the phone sent
  slat := note_snap_lat(p_lat);
  slng := note_snap_lng(slat, p_lng);
  select * into sp from note_spots s where note_dist(slat, slng, s.lat, s.lng) <= 60
    order by note_dist(slat, slng, s.lat, s.lng) limit 1;
  insert into notes (author, kind, body, cap_top, cap_bottom, image, image_state, lat, lng, spot, expires_at)
    values (me, p_kind, p_body, p_top, p_bottom, p_image, case when p_image is null then 'none' else 'pending' end,
            slat, slng, sp.id, now() + (case when sp.id is null then 7 else 10 end) * interval '1 day')
    returning * into n;
  return _note_card(n, me) || jsonb_build_object('left', 4 - today);
end;
$$;

-- open a note: within 80 m (an author can open their own from anywhere).
-- The first open by each other player counts a view.
create or replace function open_note(p_id uuid, p_lat float8, p_lng float8)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me  uuid := auth.uid();
  n   notes%rowtype;
  k   integer;
begin
  if me is null then raise exception 'sign in first'; end if;
  select * into n from notes where id = p_id;
  if not found or not _note_visible(n, me) then return jsonb_build_object('ok', false, 'why', 'gone'); end if;
  if n.author <> me then
    if not _note_near(n, p_lat, p_lng) then return jsonb_build_object('ok', false, 'why', 'far'); end if;
    insert into note_views (note, user_id) values (n.id, me) on conflict do nothing;
    get diagnostics k = row_count;
    if k > 0 then update notes set views = views + 1 where id = n.id returning * into n; end if;
  end if;
  return _note_card(n, me);
end;
$$;

-- vote: 1 up, -1 down, 0 takes it back. One per player per note (changeable),
-- within 80 m, never on your own note.
create or replace function vote_note(p_id uuid, p_lat float8, p_lng float8, p_v integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me  uuid := auth.uid();
  n   notes%rowtype;
begin
  if me is null then raise exception 'sign in first'; end if;
  if p_v not in (-1, 0, 1) then raise exception 'bad vote'; end if;
  select * into n from notes where id = p_id for update;
  if not found or not _note_visible(n, me) then return jsonb_build_object('ok', false, 'why', 'gone'); end if;
  if n.author = me then return jsonb_build_object('ok', false, 'why', 'own'); end if;
  if not _note_near(n, p_lat, p_lng) then return jsonb_build_object('ok', false, 'why', 'far'); end if;
  if p_v = 0 then delete from note_votes where note = n.id and user_id = me;
  else
    insert into note_votes (note, user_id, v, w) values (n.id, me, p_v, _note_trust(me))
      on conflict (note, user_id) do update set v = excluded.v, w = excluded.w, at = now();
  end if;
  perform _note_recount(n.id);
  select * into n from notes where id = p_id;
  return _note_card(n, me);
end;
$$;

-- agree (1) / disagree (-1) / take it back (0): no effect on the note's life
create or replace function react_note(p_id uuid, p_lat float8, p_lng float8, p_r integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me  uuid := auth.uid();
  n   notes%rowtype;
begin
  if me is null then raise exception 'sign in first'; end if;
  if p_r not in (-1, 0, 1) then raise exception 'bad reaction'; end if;
  select * into n from notes where id = p_id for update;
  if not found or not _note_visible(n, me) then return jsonb_build_object('ok', false, 'why', 'gone'); end if;
  if n.author = me then return jsonb_build_object('ok', false, 'why', 'own'); end if;
  if not _note_near(n, p_lat, p_lng) then return jsonb_build_object('ok', false, 'why', 'far'); end if;
  if p_r = 0 then delete from note_reacts where note = n.id and user_id = me;
  else
    insert into note_reacts (note, user_id, r) values (n.id, me, p_r)
      on conflict (note, user_id) do update set r = excluded.r;
  end if;
  update notes set agree = (select count(*) from note_reacts where note = n.id and r = 1),
    disagree = (select count(*) from note_reacts where note = n.id and r = -1) where id = n.id
    returning * into n;
  return _note_card(n, me);
end;
$$;

-- report: hidden for everyone at once, until an admin reviews it (within
-- 80 m like reading; 20 reports a day per player)
create or replace function report_note(p_id uuid, p_lat float8, p_lng float8)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me  uuid := auth.uid();
  n   notes%rowtype;
begin
  if me is null then raise exception 'sign in first'; end if;
  select * into n from notes where id = p_id for update;
  if not found or not _note_visible(n, me) then return jsonb_build_object('ok', true); end if;
  if n.author <> me and not _note_near(n, p_lat, p_lng) then return jsonb_build_object('ok', false, 'why', 'far'); end if;
  if (select count(*) from note_reports where reporter = me and created_at > now() - interval '1 day') >= 20 then
    return jsonb_build_object('ok', false, 'why', 'limit');
  end if;
  insert into note_reports (note, reporter) values (n.id, me) on conflict do nothing;
  -- (a note an admin already reviewed and kept stays up; the report still queues)
  if n.status = 'live' then update notes set status = 'reported' where id = n.id; end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- an author takes their own note down
create or replace function remove_my_note(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  delete from notes where id = p_id and author = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

-- admins: the reported queue, and a verdict: restore (back up, stays up),
-- remove (an upheld report: the author's votes weigh 0 from now on), ban
-- (removed, and the author can't leave notes any more)
create or replace function note_reports_queue()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from admins where user_id = auth.uid()) then raise exception 'admins only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'body', n.body, 'top', n.cap_top, 'bottom', n.cap_bottom,
      'image', n.image, 'reports', (select count(*) from note_reports r where r.note = n.id), 'created_at', n.created_at) order by n.created_at)
    from notes n where n.status = 'reported'), '[]'::jsonb);
end;
$$;
create or replace function review_note(p_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a uuid;
begin
  if not exists (select 1 from admins where user_id = auth.uid()) then raise exception 'admins only'; end if;
  if p_action not in ('restore', 'remove', 'ban') then raise exception 'bad action'; end if;
  update notes set status = case when p_action = 'restore' then 'restored' else 'removed' end where id = p_id returning author into a;
  if a is null then raise exception 'no such note'; end if;
  if p_action = 'ban' then
    insert into note_bans (user_id, reason) values (a, 'notes') on conflict (user_id) do update set until = null, created_at = now();
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- the moderation function (service role only): a pending image passed or not
create or replace function note_image_verdict(p_id uuid, p_ok boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update notes set image_state = case when p_ok then 'approved' else 'rejected' end
    where id = p_id and image_state = 'pending';
  return jsonb_build_object('ok', found);
end;
$$;

revoke all on function note_text_problem(text), _note_verified(uuid), _note_banned(uuid), _note_trust(uuid), _note_visible(notes, uuid),
  _note_pay(uuid, uuid, integer), _note_recount(uuid), _note_card(notes, uuid), _note_near(notes, float8, float8),
  note_image_verdict(uuid, boolean) from public, anon, authenticated;
revoke all on function notes_in_box(float8, float8, float8, float8), note_spot_list(), my_notes_left(),
  leave_note(float8, float8, text, text, text, text, text), open_note(uuid, float8, float8), vote_note(uuid, float8, float8, integer),
  react_note(uuid, float8, float8, integer), report_note(uuid, float8, float8), remove_my_note(uuid), note_reports_queue(), review_note(uuid, text)
  from public, anon;
grant execute on function notes_in_box(float8, float8, float8, float8), note_spot_list(), my_notes_left(),
  leave_note(float8, float8, text, text, text, text, text), open_note(uuid, float8, float8), vote_note(uuid, float8, float8, integer),
  react_note(uuid, float8, float8, integer), report_note(uuid, float8, float8), remove_my_note(uuid), note_reports_queue(), review_note(uuid, text)
  to authenticated;
grant execute on function note_image_verdict(uuid, boolean) to service_role;

-- ------------------------------------------------------------------ the photos (only where Supabase Storage exists)
--   note-uploads  private: a player writes and reads only their own folder
--                 ('<user id>/…'); the moderation function reads it
--   notes         public read: written only by the moderation function, once
--                 an image has passed, as '<note id>.jpg' (no user id in the
--                 name), so nothing unchecked is ever public
-- (A role that may not touch Storage gets a warning, not a failed migration:
-- the whole file runs as one transaction, and a refusal here would take the
-- tables and the API down with it. scripts/check_notes_setup.py says what's
-- still missing.)
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    begin
      execute $p$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        values ('note-uploads', 'note-uploads', false, 2097152, array['image/jpeg']) on conflict (id) do nothing$p$;
      execute $p$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        values ('notes', 'notes', true, 2097152, array['image/jpeg']) on conflict (id) do nothing$p$;
    exception when insufficient_privilege then
      raise warning 'notes: may not create the buckets (%): make note-uploads (private) and notes (public) in Storage', sqlerrm;
    end;
    begin
      execute 'drop policy if exists note_uploads_insert on storage.objects';
      execute $p$create policy note_uploads_insert on storage.objects for insert to authenticated
        with check (bucket_id = 'note-uploads' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
      execute 'drop policy if exists note_uploads_read on storage.objects';
      execute $p$create policy note_uploads_read on storage.objects for select to authenticated
        using (bucket_id = 'note-uploads' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    exception when insufficient_privilege then
      raise warning 'notes: may not create policies on storage.objects (%): add note_uploads_insert / note_uploads_read in Storage -> Policies (docs/notes.md)', sqlerrm;
    end;
  end if;
end;
$$;
