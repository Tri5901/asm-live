-- Classements des championnats (recopiés depuis la FFF). Lecture publique, écriture admin.
create table if not exists public.classements (
  equipe int primary key check (equipe between 1 and 5),
  competition text not null default '',
  lignes jsonb not null default '[]'::jsonb,
  source text,
  updated_at timestamptz not null default now()
);
alter table public.classements enable row level security;
drop policy if exists "classements lecture" on public.classements;
create policy "classements lecture" on public.classements for select to anon, authenticated using (true);
drop policy if exists "classements admin" on public.classements;
create policy "classements admin" on public.classements for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.classements to anon, authenticated;
grant insert, update, delete on public.classements to authenticated;
