-- 011: Secret Diary prompt log. One row per prompt SHOWN (or skipped by the
-- host) in a Secret Diary round. Collection only — nothing reads this yet;
-- later it will decide which prompts get served more.
--
-- Deliberately no user ids, no handles, no answer text: only the prompt,
-- the shape of the party, and aggregate timings/lengths for the round.

create table if not exists diary_prompt_log (
  id              bigserial primary key,
  created_at      timestamptz not null default now(),
  prompt_id       text not null,             -- id from web/data/diary_prompts.json
  level           text not null check (level in ('mild', 'spicy', 'unhinged')),
  type            text not null check (type in ('written', 'yesno')),
  party_size      int  not null,             -- human players in the game
  bots            int  not null default 0,   -- ?bots=N desk-test seats; filter these out
  visibility      text not null check (visibility in ('public', 'private')),
  skipped         boolean not null,          -- host skipped it in the preview
  round           int,                       -- 1-based round within the game
  answered        int,                       -- players who submitted an answer
  avg_submit_ms   int,                       -- mean time from prompt shown to answer
  avg_answer_len  real,                      -- mean characters per answer (written only)
  game_id         text                       -- groups rows from one game; random, not a party code
);

create index if not exists diary_prompt_log_prompt_idx on diary_prompt_log (prompt_id);

alter table diary_prompt_log enable row level security;

-- signed-in players (the party host's client) may append rows; nobody can
-- read, change or delete them from a client — analysis goes through the
-- dashboard / service role
drop policy if exists diary_prompt_log_insert on diary_prompt_log;
create policy diary_prompt_log_insert on diary_prompt_log
  for insert to authenticated
  with check (true);
