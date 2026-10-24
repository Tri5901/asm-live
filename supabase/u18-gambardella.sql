-- U18 (GJ Mésanger St Géréon) en Coupe Gambardella, 4e tour, sam. 24/10/2026 16 h contre l'AC Nort-sur-Erdre :
-- match ajouté exceptionnellement (Tristan, 24/10). L'équipe est « exceptionnelle » : visible dans la liste des matchs,
-- mais ni dans les classements, ni dans les stats, ni dans le choix des notifications ; ses notifications vont à tous
-- ceux qui suivent au moins une équipe.
alter table public.equipes add column if not exists exceptionnelle boolean not null default false;

insert into public.equipes (id, categorie, cat_ordre, ordre, nom, court, nom_club, fff_classement, actif, fff_poule, mi_temps, joueurs, exceptionnelle)
values (7, 'U18', 3, 1, 'U18', 'U18', 'GJ Mésanger St Géréon', null, true, null, 45, 11, true)
on conflict (id) do nothing;

-- notifications : les équipes exceptionnelles sont ajoutées à tout abonnement qui suit au moins une équipe
create or replace function public.push_equipes_exceptionnelles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(cardinality(new.equipes), 0) > 0 then
    new.equipes := (select array_agg(distinct e order by e)
                      from unnest(new.equipes || (select coalesce(array_agg(id), '{}') from equipes where exceptionnelle and actif)) e);
  end if;
  return new;
end $$;
drop trigger if exists push_equipes_exceptionnelles on public.push_subscriptions;
create trigger push_equipes_exceptionnelles before insert or update of equipes on public.push_subscriptions
  for each row execute function public.push_equipes_exceptionnelles();
-- abonnements existants
update public.push_subscriptions set equipes = equipes where cardinality(equipes) > 0;

-- le match (compo : convocation U18 du site du club ; arbitres et terrain : page du match sur la FFF)
insert into public.matches (kickoff, competition, equipe, club_side, home_name, away_name, opp_logo, opp_niveau, half,
                            surface, fff_match, officiels, arbitres, rosters, compo_source)
select '2026-10-24T14:00:00Z', 'Coupe Gambardella · 4e tour', 7, 'H', 'GJ Mésanger St Géréon', 'AC Nort-sur-Erdre',
       'https://cdn-transverse.azureedge.net/phlogos/BC512355.jpg', 'District 1', 45, 'Synthétique',
       '/competition/match/79893039-gjf-mesanger-st-gereon-nort-a-c', 'trio',
       '{"centre": "Julien Brehier", "a1": "Gabin Beucher", "a2": "Anthony Grieu"}'::jsonb,
       jsonb_build_object('H', (select jsonb_agg(jsonb_build_object('n', '', 'name', j, 'sub', false) order by o)
                                  from unnest(array['Martin Arrondel', 'Noah Choloux', 'Lucas Cogne', 'Eloan Daufy', 'Quentin Dubourg',
                                                    'Félicien Huard', 'Thiméo Huard', 'Isaac Jouault', 'Clément Judic', 'Tom McLellan',
                                                    'Nolan Meunier', 'Ethan Pean', 'Timéo Pean', 'Olivier Ravily', 'Théo Simon', 'Lubin Verrier'])
                                       with ordinality as t(j, o)), 'A', '[]'::jsonb),
       'convocation du site du club'
where not exists (select 1 from public.matches where equipe = 7 and competition = 'Coupe Gambardella · 4e tour');

select id, kickoff, competition, home_name, away_name, jsonb_array_length(rosters->'H') as joueurs,
       (select count(*) from push_subscriptions where 7 = any(equipes)) as abonnes_u18
  from public.matches where equipe = 7;
