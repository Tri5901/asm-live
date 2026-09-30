-- Équipes et catégories du club : une seule liste, lue par le site, les notifications et la mise à jour des classements.
-- Ajouter une catégorie (Loisirs, Seniors féminines, U18, U15…) = ajouter des lignes ici, sans toucher au code.
create table if not exists public.equipes (
  id int primary key,                 -- numéro utilisé partout (matchs, responsables, notifications, classements)
  categorie text not null,            -- « Seniors », « Loisirs », « Seniors F », « U18 »…
  cat_ordre int not null,             -- ordre des catégories à l'écran
  ordre int not null,                 -- ordre des équipes dans la catégorie
  nom text not null,                  -- « Seniors A »
  court text not null,                -- pastille courte : « A » (unique dans le club)
  nom_club text not null,             -- nom affiché dans les matchs : « AS Mésanger B »
  fff_classement text,                -- page du classement sur epreuves.fff.fr (vide = pas de championnat suivi)
  actif boolean not null default true
);
alter table public.equipes enable row level security;
drop policy if exists "equipes lecture" on public.equipes;
create policy "equipes lecture" on public.equipes for select to anon, authenticated using (true);
grant select on public.equipes to anon, authenticated;

insert into public.equipes (id, categorie, cat_ordre, ordre, nom, court, nom_club, fff_classement) values
 (1, 'Seniors', 1, 1, 'Seniors A', 'A', 'AS Mésanger',   'https://epreuves.fff.fr/competition/club/516995-mesanger-as/equipe/2026_5222_SEM_1/classement'),
 (2, 'Seniors', 1, 2, 'Seniors B', 'B', 'AS Mésanger B', 'https://epreuves.fff.fr/competition/club/516995-mesanger-as-2/equipe/2026_5222_SEM_2/classement'),
 (3, 'Seniors', 1, 3, 'Seniors C', 'C', 'AS Mésanger C', 'https://epreuves.fff.fr/competition/club/516995-mesanger-as-3/equipe/2026_5222_SEM_3/classement'),
 (4, 'Seniors', 1, 4, 'Seniors D', 'D', 'AS Mésanger D', 'https://epreuves.fff.fr/competition/club/516995-mesanger-as-4/equipe/2026_5222_SEM_4/classement'),
 (5, 'Seniors', 1, 5, 'Seniors E', 'E', 'AS Mésanger E', 'https://epreuves.fff.fr/competition/club/516995-mesanger-as-5/equipe/2026_5222_SEM_6/classement')
on conflict (id) do update set categorie = excluded.categorie, cat_ordre = excluded.cat_ordre, ordre = excluded.ordre, nom = excluded.nom,
  court = excluded.court, nom_club = excluded.nom_club, fff_classement = excluded.fff_classement;

-- Plus de limite « 1 à 5 » : une équipe doit simplement exister dans la liste
alter table public.matches drop constraint if exists matches_equipe_check;
alter table public.matches drop constraint if exists matches_equipe_fkey;
alter table public.matches add constraint matches_equipe_fkey foreign key (equipe) references public.equipes(id);
alter table public.classements drop constraint if exists classements_equipe_check;
alter table public.classements drop constraint if exists classements_equipe_fkey;
alter table public.classements add constraint classements_equipe_fkey foreign key (equipe) references public.equipes(id);

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_equipes int[], p_admin boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_admin uuid := case when p_admin and public.is_admin() then auth.uid() else null end;
begin
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or length(p_p256dh) > 200 or length(p_auth) > 100 then
    raise exception 'abonnement invalide';
  end if;
  p_equipes := coalesce(p_equipes, '{}');
  if cardinality(p_equipes) = 0 and v_admin is null then
    delete from push_subscriptions where endpoint = p_endpoint; return;
  end if;
  if exists (select 1 from unnest(p_equipes) e where not exists (select 1 from equipes q where q.id = e)) then raise exception 'équipe invalide'; end if;
  insert into push_subscriptions(endpoint, p256dh, auth, equipes, admin_id) values (p_endpoint, p_p256dh, p_auth, p_equipes, v_admin)
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, equipes = excluded.equipes, admin_id = excluded.admin_id, updated_at = now();
end $$;

create or replace function public.enregistrer_classements(p_secret text, p_data jsonb) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare k text; v jsonb; n int := 0;
begin
  if encode(digest(p_secret, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'classements') then
    raise exception 'clé invalide';
  end if;
  for k, v in select * from jsonb_each(p_data) loop
    if k !~ '^\d+$' or not exists (select 1 from equipes where id = k::int) or jsonb_typeof(v->'lignes') <> 'array' or jsonb_array_length(v->'lignes') < 2 then continue; end if;
    insert into classements (equipe, competition, lignes, source, updated_at)
    values (k::int, coalesce(v->>'competition', ''), v->'lignes', coalesce(v->>'source', (select fff_classement from equipes where id = k::int)), now())
    on conflict (equipe) do update set competition = coalesce(nullif(excluded.competition, ''), classements.competition),
      lignes = excluded.lignes, source = coalesce(excluded.source, classements.source), updated_at = now();
    n := n + 1;
  end loop;
  update classements_maj set fait_at = now() where id = 1;
  return n;
end $$;
select categorie, count(*) as equipes from public.equipes group by categorie;
