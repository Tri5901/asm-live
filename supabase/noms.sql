-- Noms des comptes : toujours « Prénom Nom », première lettre en majuscule, le reste en minuscules
-- (Jean-Pierre Le Goff, Léa D'Almeida). Appliqué par la base, quel que soit le téléphone.

create or replace function public.format_nom(t text) returns text
language sql immutable as $$
  select initcap(lower(regexp_replace(trim(coalesce(t, '')), '\s+', ' ', 'g')));
$$;

create or replace function public.profiles_format_nom() returns trigger
language plpgsql as $$
begin
  new.nom := public.format_nom(new.nom);
  return new;
end $$;
drop trigger if exists profiles_format_nom on public.profiles;
create trigger profiles_format_nom before insert or update of nom on public.profiles
  for each row execute function public.profiles_format_nom();

-- Le nom du délégué recopié sur les matchs suit le changement de nom
create or replace function public.profiles_sync_delegue_nom() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.matches set delegue_nom = new.nom where delegue_id = new.id and delegue_nom is distinct from new.nom;
  return new;
end $$;
drop trigger if exists profiles_sync_delegue_nom on public.profiles;
create trigger profiles_sync_delegue_nom after update of nom on public.profiles
  for each row when (old.nom is distinct from new.nom) execute function public.profiles_sync_delegue_nom();

-- Chacun renseigne son propre nom (sans pouvoir toucher à son rôle)
create or replace function public.set_mon_nom(p_prenom text, p_nom text) returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  if length(trim(coalesce(p_prenom, ''))) < 2 or length(trim(coalesce(p_nom, ''))) < 2 then
    raise exception 'prénom et nom obligatoires';
  end if;
  v := public.format_nom(p_prenom) || ' ' || public.format_nom(p_nom);
  update public.profiles set nom = v where id = auth.uid();
  return v;
end $$;
revoke all on function public.set_mon_nom(text, text) from public, anon;
grant execute on function public.set_mon_nom(text, text) to authenticated;

-- Remise en forme des noms déjà saisis
update public.profiles set nom = public.format_nom(nom) where nom is distinct from public.format_nom(nom);
