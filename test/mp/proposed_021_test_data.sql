-- PROPOSED, NOT APPLIED (and deliberately not in supabase/migrations/):
-- what the multiplayer suite (test/mp/) needs from the server to run against
-- a Vercel preview without touching real players. A preview deploys the same
-- web/config.js, so it talks to the PRODUCTION Supabase project: anything a
-- test guest does there is seen by real players in Itaewon unless the server
-- keeps test data apart. Review, then apply by hand like any migration
-- (scripts/apply_migration.py) as 021_test_data.sql.
--
-- Test data is recognisable without trusting the client for anything that
-- matters: a test guest is a normal anonymous user whose handle starts with
-- "mpt-" (the suite names every guest mpt-<run tag>-<name>), and its chat
-- lines / notes start with "[mpt ". Marking yourself as a test user can only
-- ever HIDE your own content from real players, never reveal anyone else's,
-- so a client faking it gains nothing.
--
-- 1. test guests and real players don't see each other on the map
-- 2. world chat: test lines only reach test guests; the sender may delete
--    their own lines (the suite's cleanup)
-- 3. notes: test notes only show to test guests and expire in 30 minutes
-- 4. a nightly sweep removes test guests (and, by cascade, what they left)

create or replace function _is_test_user(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select handle like 'mpt-%' from profiles where id = u), false)
$$;

-- 1. the map (get_world as in 010_tap_dm.sql, plus the test/real split)
create or replace function get_world()
returns table(zone_id text, avatar jsonb, is_self boolean, user_id uuid, handle text)
language sql security definer set search_path = public as $$
  select p.zone_id, pr.avatar, (p.user_id = auth.uid()) as is_self,
         p.user_id, pr.handle
  from presence p
  join profiles pr on pr.id = p.user_id
  where p.updated_at > now() - interval '45 minutes'
    and (pr.handle like 'mpt-%') = _is_test_user(auth.uid())
  order by random();
$$;

-- 2. world chat (Realtime's postgres_changes applies the select policy too)
drop policy if exists "signed-in users read public chat" on public.public_messages;
create policy "signed-in users read public chat"
  on public.public_messages for select to authenticated
  using ((handle like 'mpt-%') = _is_test_user(auth.uid()));
create policy "delete your own public message"
  on public.public_messages for delete to authenticated
  using (sender = auth.uid());

-- 3. notes: hidden from real players, and short-lived
create or replace function _note_visible(n notes, me uuid) returns boolean
language sql stable as $$
  select n.status in ('live', 'restored')
     and (n.landmark or n.expires_at > now())
     and (n.image_state in ('none', 'approved') or n.author = me)
     and ((coalesce(n.body, '') like '[mpt %') = _is_test_user(me))
$$;
create or replace function _test_note_expiry() returns trigger
language plpgsql as $$
begin
  if coalesce(new.body, '') like '[mpt %' then
    new.expires_at := least(new.expires_at, now() + interval '30 minutes');
    new.landmark := false;
  end if;
  return new;
end $$;
drop trigger if exists test_note_expiry on notes;
create trigger test_note_expiry before insert or update on notes
  for each row execute function _test_note_expiry();

-- 4. the nightly sweep: test guests older than a day go (auth.users cascades
--    to profiles, presence, public_messages, notes)
select cron.schedule('sweep-test-guests', '17 4 * * *', $$
  delete from auth.users u using public.profiles p
   where p.id = u.id and p.handle like 'mpt-%' and u.created_at < now() - interval '1 day'
$$);
