-- Photothèque : une photo concerne le club et/ou une ou plusieurs équipes (choisi à l'ajout, modifiable en touchant la photo).
alter table public.pub_photos add column if not exists club boolean;
alter table public.pub_photos add column if not exists equipes int[] not null default '{}';
update public.pub_photos set club = (equipe is null), equipes = case when equipe is null then '{}'::int[] else array[equipe] end where club is null;
alter table public.pub_photos alter column club set default false;
alter table public.pub_photos alter column club set not null;
-- ajout par une ancienne version de l'appli (colonne equipe seule) : étiquettes déduites
create or replace function public.pub_photos_tags() returns trigger language plpgsql as $$
begin
  if coalesce(cardinality(new.equipes), 0) = 0 and not coalesce(new.club, false) then
    if new.equipe is not null then new.equipes := array[new.equipe]; else new.club := true; end if;
  end if;
  return new;
end $$;
drop trigger if exists pub_photos_tags on public.pub_photos;
create trigger pub_photos_tags before insert or update on public.pub_photos for each row execute function public.pub_photos_tags();
select count(*) filter (where club) as club, count(*) filter (where cardinality(equipes) > 0) as avec_equipe, count(*) as photos from public.pub_photos;
