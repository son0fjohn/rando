-- Humiliation Ritual: the prompt is drawn on the server and handed to the
-- performer's phone only.
--
-- Before this, the host's phone dealt the prompt into the synced game state,
-- so every phone received it and only the UI hid it. Now the performer's own
-- phone calls ritual_draw(room, turn, level) when its turn comes up: the
-- server picks a prompt this room hasn't had yet (up to the party's level),
-- remembers it for that (room, turn, caller), and returns it to the caller
-- alone. Nobody else is ever sent it (the host's game state carries no prompt
-- and no prompt id). The answer is shown to everyone only when the turn ends,
-- and only because the performer's phone sends it then.
--
-- Anyone can call ritual_draw, but it only ever deals the CALLER a prompt of
-- their own, and it prefers prompts this room hasn't had, so drawing "for"
-- someone else's turn can't reveal theirs.
--
-- The prompts mirror web/data/ritual_prompts.json (ids are permanent; the
-- SQL test checks the two match). Adding or editing prompts = a new
-- migration that upserts them here too.

create table if not exists ritual_prompts (
  id    text primary key,
  level text not null check (level in ('mild', 'spicy', 'unhinged')),
  text  text not null
);

create table if not exists ritual_draws (
  room      text not null,
  turn_key  text not null,
  performer uuid not null,
  prompt_id text not null references ritual_prompts (id),
  drawn_at  timestamptz not null default now(),
  primary key (room, turn_key, performer)
);
create index if not exists ritual_draws_room on ritual_draws (room, prompt_id);
create index if not exists ritual_draws_age on ritual_draws (drawn_at);

-- no policies: clients can't read or write either table
alter table ritual_prompts enable row level security;
alter table ritual_draws enable row level security;
revoke all on ritual_prompts, ritual_draws from anon, authenticated;

insert into ritual_prompts (id, level, text) values
  ('hr-mild-01', 'mild', 'Peeing dog'),
  ('hr-mild-02', 'mild', 'Ex-boyfriend'),
  ('hr-mild-03', 'mild', 'Kid throwing a tantrum'),
  ('hr-mild-04', 'mild', 'Constipated person'),
  ('hr-mild-05', 'mild', 'Person with diarrhea'),
  ('hr-spicy-01', 'spicy', 'Masochist'),
  ('hr-mild-06', 'mild', 'Sydney Sweeney'),
  ('hr-mild-07', 'mild', 'Michael Jordan'),
  ('hr-mild-08', 'mild', 'Jake Paul'),
  ('hr-mild-09', 'mild', 'Mike Tyson'),
  ('hr-mild-10', 'mild', 'IShowSpeed'),
  ('hr-mild-11', 'mild', 'Alysa Liu')
on conflict (id) do update set level = excluded.level, text = excluded.text;

create or replace function ritual_draw(p_room text, p_turn text, p_level text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me  uuid := auth.uid();
  lv  integer := array_position(array['mild', 'spicy', 'unhinged'], p_level);
  got record;
begin
  if me is null then raise exception 'sign in first'; end if;
  if p_room !~ '^[A-Za-z0-9_.:-]{1,80}$' or p_turn !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'bad turn'; end if;
  if lv is null then raise exception 'bad level'; end if;
  -- a retry (a reload, a second tab) gets the same prompt back
  select p.id, p.text into got from ritual_draws d join ritual_prompts p on p.id = d.prompt_id
    where d.room = p_room and d.turn_key = p_turn and d.performer = me;
  if found then return jsonb_build_object('id', got.id, 'text', got.text); end if;
  -- one this room hasn't had yet; once they're all used, any of them
  select p.id, p.text into got from ritual_prompts p
    where array_position(array['mild', 'spicy', 'unhinged'], p.level) <= lv
    order by exists (select 1 from ritual_draws d where d.room = p_room and d.prompt_id = p.id), random()
    limit 1;
  if not found then raise exception 'no prompts'; end if;
  insert into ritual_draws (room, turn_key, performer, prompt_id) values (p_room, p_turn, me, got.id);
  -- a draw is only needed for the length of a party
  delete from ritual_draws where drawn_at < now() - interval '1 day';
  return jsonb_build_object('id', got.id, 'text', got.text);
end;
$$;

revoke all on function ritual_draw(text, text, text) from public, anon;
grant execute on function ritual_draw(text, text, text) to authenticated;
