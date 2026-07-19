-- 006: mutual tap-confirm (spec line 134) — both participants must
-- independently confirm an encounter; no single-party self-report counts.
--
-- Blind-until-both (confirmed 2026-07-19): the select policy lets you read
-- ONLY your own confirm row, so no client — not even a modified one — can
-- learn whether the partner has confirmed. Completion is revealed solely
-- by encounter_status(), and only once BOTH confirms exist.
-- Confirms are immutable: no update/delete policies.
-- Points/friend-adding will consume encounter_complete later; the
-- mechanism itself is the deliverable here.

create table public.encounter_confirms (
  match_id     uuid not null references public.matches (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

alter table public.encounter_confirms enable row level security;

create policy "confirm own encounter"
  on public.encounter_confirms for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from matches m
      where m.id = match_id
        and m.status = 'active'
        and auth.uid() in (m.user_a, m.user_b)
    )
  );

create policy "read own confirm"
  on public.encounter_confirms for select
  using (user_id = auth.uid());

create or replace function public.encounter_status(p_match uuid)
returns table (i_confirmed boolean, encounter_complete boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from matches m
    where m.id = p_match and auth.uid() in (m.user_a, m.user_b)
  ) then
    raise exception 'not your match';
  end if;
  return query select
    exists (select 1 from encounter_confirms c
            where c.match_id = p_match and c.user_id = auth.uid()),
    (select count(*) = 2 from encounter_confirms c
     where c.match_id = p_match);
end;
$$;

revoke all on function public.encounter_status(uuid) from public, anon;
grant execute on function public.encounter_status(uuid) to authenticated;
