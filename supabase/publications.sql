-- Publications des résultats (onglet Admin › Publications) : photothèque par équipe, brouillons des posts du week-end,
-- réglage de la publication automatique. Tout est réservé aux admins ; Facebook / Instagram seront branchés plus tard.

-- photos : stockage public en lecture (fonds des visuels), écriture par les admins
insert into storage.buckets (id, name, public) values ('photos', 'photos', true) on conflict (id) do nothing;
drop policy if exists "photos admin ajout" on storage.objects;
create policy "photos admin ajout" on storage.objects for insert to authenticated with check (bucket_id = 'photos' and public.is_admin());
drop policy if exists "photos admin suppression" on storage.objects;
create policy "photos admin suppression" on storage.objects for delete to authenticated using (bucket_id = 'photos' and public.is_admin());

-- photothèque : une photo appartient à une équipe (null = photo du club, pour toutes les équipes)
create table if not exists public.pub_photos (
  id uuid primary key default gen_random_uuid(),
  equipe int references public.equipes(id) on delete cascade,
  chemin text not null,                     -- chemin dans le stockage « photos »
  largeur int, hauteur int,
  ajoute_par uuid default auth.uid(),
  ajoute_le timestamptz not null default now()
);
alter table public.pub_photos enable row level security;
drop policy if exists "pub_photos admin" on public.pub_photos;
create policy "pub_photos admin" on public.pub_photos for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.pub_photos to authenticated;

-- brouillons / posts : un par week-end (id = samedi du week-end, AAAA-MM-JJ)
create table if not exists public.publications (
  id text primary key,
  data jsonb not null default '{}'::jsonb,  -- fonds et cadrages par image, matchs retirés, texte retouché
  statut text not null default 'brouillon' check (statut in ('brouillon', 'publiee')),
  publie_le timestamptz,
  maj_par uuid default auth.uid(),
  maj_le timestamptz not null default now()
);
alter table public.publications enable row level security;
drop policy if exists "publications admin" on public.publications;
create policy "publications admin" on public.publications for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.publications to authenticated;

-- réglage de la publication automatique (une seule ligne)
create table if not exists public.pub_reglages (
  id int primary key default 1 check (id = 1),
  auto boolean not null default false,
  reseaux text[] not null default '{instagram,facebook}',
  heure int not null default 20 check (heure between 0 and 23),
  maj_le timestamptz not null default now()
);
insert into public.pub_reglages (id) values (1) on conflict (id) do nothing;
alter table public.pub_reglages enable row level security;
drop policy if exists "pub_reglages admin" on public.pub_reglages;
create policy "pub_reglages admin" on public.pub_reglages for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.pub_reglages to authenticated;

select (select public from storage.buckets where id = 'photos') as photos_public,
  (select count(*) from pg_policies where tablename in ('pub_photos', 'publications', 'pub_reglages')) as regles;
