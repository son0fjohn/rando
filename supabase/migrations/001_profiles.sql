-- 001: profiles — avatar-only identity
-- Spec (Safety architecture): "No persistent identifying features — avatar
-- only, never a real name or photo." Phone numbers live ONLY in auth.users
-- (managed by Supabase Auth, unique per account) and are never copied here,
-- so no profile endpoint can ever leak one (the Zenly lesson, spec line 133).

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  handle     text not null unique,
  avatar     jsonb not null default '{"outfit": "red-tank"}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Mutual reveal only (spec line 130): until matching exists, the only
-- profile you can see is your own. Match-scoped visibility is added in a
-- later migration, deliberately not as a blanket public read.
create policy "read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create a profile with a generated handle on signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, handle)
  values (new.id, 'rando-' || substr(replace(new.id::text, '-', ''), 1, 6));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
