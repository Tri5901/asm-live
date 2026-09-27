-- AS Mésanger – Feuille de match : schéma Supabase
-- À exécuter une fois dans SQL Editor (projet dédié au club).

-- Profils : un par compte. Le tout premier compte créé devient admin,
-- les suivants sont "en attente" jusqu'à validation par un admin.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nom text,
  role text not null default 'pending' check (role in ('pending','delegue','admin')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, nom, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nom', ''),
          case when exists (select 1 from public.profiles where role = 'admin') then 'pending' else 'admin' end);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('delegue','admin'));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Matchs : l'état du chrono est stocké pour que les spectateurs le voient tourner.
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  kickoff timestamptz not null default now(),
  competition text not null default '',
  club_side text not null default 'H' check (club_side in ('H','A')),
  home_name text not null default '',
  away_name text not null default '',
  half int not null default 45 check (half = 45),
  period int not null default 0,
  running boolean not null default false,
  started_at bigint not null default 0,
  acc bigint not null default 0,
  status text not null default 'prevu' check (status in ('prevu','direct','termine')),
  rosters jsonb not null default '{"H":[],"A":[]}'::jsonb,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Actions du match (buts, remplacements, cartons)
create table if not exists public.events (
  id uuid primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  t text not null check (t in ('H','A')),
  k text not null check (k in ('goal','sub','yellow','red')),
  n text, out_n text, in_n text,
  min text not null default '',
  sort numeric not null default 0,
  p int not null default 1,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists events_match_idx on public.events(match_id);

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.events enable row level security;

drop policy if exists "profiles lecture" on public.profiles;
create policy "profiles lecture" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles admin" on public.profiles;
create policy "profiles admin" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "matches lecture" on public.matches;
create policy "matches lecture" on public.matches for select to anon, authenticated using (true);
drop policy if exists "matches staff" on public.matches;
create policy "matches staff" on public.matches for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "events lecture" on public.events;
create policy "events lecture" on public.events for select to anon, authenticated using (true);
drop policy if exists "events staff" on public.events;
create policy "events staff" on public.events for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

grant select on public.matches, public.events to anon, authenticated;
grant insert, update, delete on public.matches, public.events to authenticated;
grant select, update on public.profiles to authenticated;

-- Direct : les spectateurs reçoivent les changements en temps réel
do $$ begin
  alter publication supabase_realtime add table public.matches;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.events;
exception when duplicate_object then null; end $$;
