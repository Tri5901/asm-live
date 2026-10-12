-- Cadrage par défaut propre à une photo de la photothèque ({z, fx, fy}, appliqué quand elle sert de fond, modifiable ensuite
-- dans chaque visuel). Vide pour toutes les photos : par défaut l'appli montre toute la largeur de la photo (fond flou autour).
alter table public.pub_photos add column if not exists cadrage jsonb;
update public.pub_photos set cadrage = null where cadrage is not null;
select count(*) filter (where cadrage is not null) as photos_cadrees, count(*) as photos from public.pub_photos;
