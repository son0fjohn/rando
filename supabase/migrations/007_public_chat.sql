-- 007: public chat — real world-wide messages, Twitch/Minecraft-feed style.
-- Spec core loop step 5: "Public + private chat already open."
--
-- Safety posture: the sender's HANDLE (pseudonymous, avatar-only identity)
-- is shown, matching public-chat norms; the zone attached to a message is
-- derived server-side from the sender's presence row (you cannot claim a
-- zone you aren't in), and speaking requires being open. Bubbles render at
-- the zone CLUSTER client-side — presence itself stays identity-free.

create table public.public_messages (
  id         uuid primary key default gen_random_uuid(),
  sender     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  handle     text not null default '',
  zone_id    text not null references public.zones (id),
  body       text not null check (char_length(body) between 1 and 280),
  created_at timestamptz not null default now()
);

create index public_messages_created on public.public_messages (created_at desc);

alter table public.public_messages enable row level security;

create policy "signed-in users read public chat"
  on public.public_messages for select
  to authenticated
  using (true);

create policy "send as yourself"
  on public.public_messages for insert
  with check (sender = auth.uid());

-- server owns sender/zone/handle/timestamp; client supplies only body
create or replace function public.prepare_public_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  z text;
  h text;
begin
  new.sender := auth.uid();
  new.created_at := now();
  select zone_id into z from presence where user_id = auth.uid();
  if z is null then
    raise exception 'go open to talk in public chat';
  end if;
  new.zone_id := z;
  select handle into h from profiles where id = auth.uid();
  new.handle := coalesce(h, 'rando');
  return new;
end;
$$;

create trigger prepare_public_message
  before insert on public.public_messages
  for each row execute function public.prepare_public_message();

alter publication supabase_realtime add table public.public_messages;
