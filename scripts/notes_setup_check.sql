-- Is this Supabase project set up for notes on the map (docs/notes.md "Set up")?
-- Read-only: a session-temporary function, then one jsonb row. Run by
-- scripts/check_notes_setup.py through the Management API (which adds the
-- Edge Function and its secrets, which SQL can't see) and by
-- test/notes_sql.mjs in PGlite. Every check answers (false / null) instead of
-- failing when a piece is missing: no Storage schema, no notes table, no
-- function.
create or replace function pg_temp.notes_setup() returns jsonb language plpgsql as $$
declare
  api text[] := array['public.notes_in_box(float8,float8,float8,float8)', 'public.note_spot_list()', 'public.my_notes_left()',
                      'public.leave_note(float8,float8,text,text,text,text,text)', 'public.open_note(uuid,float8,float8)',
                      'public.vote_note(uuid,float8,float8,integer)', 'public.react_note(uuid,float8,float8,integer)',
                      'public.report_note(uuid,float8,float8)', 'public.remove_my_note(uuid)'];
  out jsonb := '{}'::jsonb;
  v jsonb;
  n integer;
begin
  -- 019_notes.sql: the tables, and the API the app calls (web/notes.js)
  select coalesce(jsonb_object_agg(t, to_regclass('public.' || t) is not null), '{}'::jsonb) into v
    from unnest(array['notes', 'note_spots', 'note_slurs', 'note_votes', 'note_reacts', 'note_views', 'note_reports', 'note_bans']) t;
  out := out || jsonb_build_object('tables', v);
  select coalesce(jsonb_object_agg(regexp_replace(f, '^public\.|\(.*$', '', 'g'), to_regprocedure(f) is not null), '{}'::jsonb) into v
    from unnest(api || 'public.note_image_verdict(uuid,boolean)'::text) f;
  out := out || jsonb_build_object('functions', v);
  -- signed-in players may call them (guests too: an anonymous sign-in is `authenticated`); anon may not
  out := out || jsonb_build_object(
    'granted', (select coalesce(bool_and(has_function_privilege('authenticated', to_regprocedure(f), 'execute')), false)
                  from unnest(api) f where to_regprocedure(f) is not null),
    'anon_blocked', (select coalesce(bool_and(not has_function_privilege('anon', to_regprocedure(f), 'execute')), true)
                  from unnest(api) f where to_regprocedure(f) is not null),
    -- 020_notes_no_verify.sql: leave_note doesn't ask for a verified phone
    -- (re-running 019 after 020 puts the check back: apply 020 again then)
    'no_verify', (select position('_note_verified(me)' in prosrc) = 0 from pg_proc
                  where oid = to_regprocedure('public.leave_note(float8,float8,text,text,text,text,text)')));
  -- the two buckets (019 makes them where Storage is) and the private one's policies
  out := out || jsonb_build_object('storage', to_regclass('storage.buckets') is not null);
  if to_regclass('storage.buckets') is not null then
    execute $q$select coalesce(jsonb_object_agg(id, jsonb_build_object('public', public, 'types', allowed_mime_types, 'max', file_size_limit)), '{}'::jsonb)
               from storage.buckets where id in ('note-uploads', 'notes')$q$ into v;
    out := out || jsonb_build_object('buckets', v);
  end if;
  select coalesce(jsonb_agg(policyname::text order by policyname), '[]'::jsonb) into v from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname in ('note_uploads_insert', 'note_uploads_read');
  out := out || jsonb_build_object('policies', v);
  if to_regclass('public.notes') is not null then
    -- pictures still waiting on moderate-note after 5 minutes: it isn't
    -- deployed, has no provider key, or can't reach the provider
    execute $q$select count(*) from public.notes where image_state = 'pending' and created_at < now() - interval '5 minutes'$q$ into n;
    out := out || jsonb_build_object('stuck_pending', n);
    execute $q$select count(*) from public.notes where status in ('live', 'restored')$q$ into n;
    out := out || jsonb_build_object('live_notes', n);
  end if;
  return out;
end;
$$;
select pg_temp.notes_setup() as notes_setup;
