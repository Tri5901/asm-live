-- Loisirs au-dessus des U18 dans les catégories (Tristan, 25/10)
update public.equipes set cat_ordre = 3 where categorie = 'Loisirs';
update public.equipes set cat_ordre = 4 where categorie = 'U18';
select categorie, min(cat_ordre) from public.equipes group by 1 order by 2;
