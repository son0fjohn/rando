-- 010: tap-to-chat. Product decision (2026-07-24): any visible character
-- can be tapped to open a private chat — no match/proximity gating. World
-- rows therefore carry user_id + handle (pseudonymous). DM threads are
-- matches with status 'dm' so the matchmaking flow (single 'active'
-- match per user) is undisturbed.

alter table matches drop constraint matches_status_check;
alter table matches add constraint matches_status_check
  check (status = any (array['active'::text, 'closed'::text, 'dm'::text]));

drop function get_world();
create function get_world()
returns table(zone_id text, avatar jsonb, is_self boolean, user_id uuid, handle text)
language sql security definer set search_path = public as $$
  select p.zone_id, pr.avatar, (p.user_id = auth.uid()) as is_self,
         p.user_id, pr.handle
  from presence p
  join profiles pr on pr.id = p.user_id
  where p.updated_at > now() - interval '45 minutes'
  order by random();
$$;

create or replace function ensure_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare mid uuid; zid text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_other is null or p_other = auth.uid() then
    raise exception 'invalid dm target';
  end if;
  if not exists (select 1 from profiles where id = p_other) then
    raise exception 'no such user';
  end if;
  select id into mid from matches
   where (user_a = auth.uid() and user_b = p_other)
      or (user_a = p_other and user_b = auth.uid())
   order by created_at desc limit 1;
  if mid is not null then return mid; end if;
  select zone_id into zid from presence where user_id = auth.uid();
  if zid is null then
    select zone_id into zid from presence where user_id = p_other;
  end if;
  if zid is null then zid := 'itaewon-station'; end if;
  insert into matches (user_a, user_b, zone_id, status)
  values (auth.uid(), p_other, zid, 'dm')
  returning id into mid;
  return mid;
end $$;
revoke all on function ensure_dm(uuid) from public;
grant execute on function ensure_dm(uuid) to authenticated;

drop policy "participants send in active match" on messages;
create policy "participants send in active or dm match" on messages
  for insert with check (
    sender = auth.uid() and exists (
      select 1 from matches m
      where m.id = messages.match_id
        and m.status in ('active', 'dm')
        and (auth.uid() = m.user_a or auth.uid() = m.user_b)));
