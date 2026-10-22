-- The old dare game ('mission') is retired and Mask Off takes its place in the
-- party: the host's report accepts 'mask_off' and no longer 'mission'. Same
-- function as 013 otherwise (report_game's signature and grants are unchanged).
create or replace function report_game(p_session text, p_set integer, p_idx integer, p_game text, p_ranking jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  n      integer;
  paid   integer := 0;
  u      record;
begin
  if me is null then raise exception 'sign in first'; end if;
  if p_game not in ('secretdiary', 'mask_off', 'ritual', 'artgallery', 'manhunt', 'sidequest') then raise exception 'unknown game'; end if;
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
