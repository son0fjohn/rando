-- 017: onboarding analytics. Privacy-safe by construction:
--   * `device` is a random id for one install of the app, not the account
--     (no user id is stored, so events can't be joined to a profile)
--   * the event name is one of a fixed list; props are a few small labels
--     and numbers (web/analytics.js whitelists them before sending)
--   * never a location, a name, a party code or anything a player typed
-- Clients can only insert. Nobody reads the table directly; the numbers come
-- from onboarding_stats(), which only an admin can call.

create table if not exists public.events (
  id bigserial primary key,
  at timestamptz not null default now(),
  device text not null check (device ~ '^[A-Za-z0-9-]{8,64}$'),
  name text not null check (name in (
    'app_open', 'party_link_opened', 'joined_party', 'name_set', 'character_shuffled', 'character_confirmed',
    'first_game_started', 'first_game_finished', 'recap_shown', 'recap_shared', 'own_party_created', 'invite_sent',
    'verification_prompted', 'verification_completed', 'permission_prompted', 'permission_granted', 'permission_declined')),
  props jsonb not null default '{}'::jsonb check (jsonb_typeof(props) = 'object' and pg_column_size(props) < 512),
  lang text check (lang in ('en', 'ko'))
);
create index if not exists events_device_at on public.events (device, at);
create index if not exists events_name_at on public.events (name, at);

alter table public.events enable row level security;
drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to anon, authenticated
  with check (at > now() - interval '5 minutes' and at < now() + interval '5 minutes');
revoke all on public.events from anon, authenticated;
grant insert (device, name, props, lang) on public.events to anon, authenticated;
grant usage on sequence public.events_id_seq to anon, authenticated;

-- who may see the dashboard: added by hand (scripts/apply_migration.py or the SQL editor)
create table if not exists public.admins (user_id uuid primary key references auth.users (id) on delete cascade);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

-- the onboarding dashboard over the last p_days days:
--   median time from first open to first game, % of invite opens that join,
--   % of first games that end in a finished first party, % who host within 7 days,
--   and a count per event
create or replace function public.onboarding_stats(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365)));
  out jsonb;
begin
  if not exists (select 1 from admins where user_id = auth.uid()) then
    raise exception 'admins only';
  end if;
  with ev as (select * from events where at >= since),
  first_open as (select device, min(at) t0 from ev where name = 'app_open' group by device),
  first_game as (select device, min((props->>'ms')::numeric) ms from ev where name = 'first_game_started' and props ? 'ms' group by device),
  opened as (select distinct device from ev where name = 'party_link_opened'),
  joined as (select distinct device from ev where name = 'joined_party'),
  started as (select distinct device from ev where name = 'first_game_started'),
  recapped as (select distinct device from ev where name = 'recap_shown'),
  hosted as (
    select distinct f.device from first_open f join ev e on e.device = f.device
    where e.name = 'own_party_created' and e.at <= f.t0 + interval '7 days'),
  -- only installs old enough to have had their 7 days
  eligible as (select device from first_open where t0 <= now() - interval '7 days')
  select jsonb_build_object(
    'days', greatest(1, least(p_days, 365)),
    'installs', (select count(*) from first_open),
    'median_ms_to_first_game', (select percentile_cont(0.5) within group (order by ms) from first_game),
    'invite_opens', (select count(*) from opened),
    'invite_joins', (select count(*) from opened o where o.device in (select device from joined)),
    'first_games', (select count(*) from started),
    'first_parties_finished', (select count(*) from started s where s.device in (select device from recapped)),
    'hosted_within_7d', (select count(*) from eligible e where e.device in (select device from hosted)),
    'eligible_7d', (select count(*) from eligible),
    'events', (select coalesce(jsonb_object_agg(name, n), '{}'::jsonb) from (select name, count(*) n from ev group by name) c)
  ) into out;
  return out;
end $$;
revoke all on function public.onboarding_stats(int) from public, anon;
grant execute on function public.onboarding_stats(int) to authenticated;
