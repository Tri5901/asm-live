-- Niveau de championnat d'une équipe dont l'appli n'a pas les matchs de championnat (équipe exceptionnelle) :
-- sert à l'écart de divisions des matchs de coupe (« Même niveau », « Adversaire 2 divisions au-dessus »).
alter table public.equipes add column if not exists niveau text;
update public.equipes set niveau = 'District 1' where id = 7 and niveau is distinct from 'District 1';   -- U18 : District 1 U18
select id, nom, niveau from public.equipes where niveau is not null;
