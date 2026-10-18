-- Compte reconnu comme joueur des compos : rôle « joueur » plutôt que « supporter » (demande de Tristan, 18/10).
-- 1) Compte lié à un joueur (« C'est moi » dans Mon compte, ou un admin) : un supporter devient joueur.
-- 2) À la création du compte, ou quand la personne donne son nom : si ce nom est celui d'un joueur de nos compos
--    (sans tenir compte des accents, des majuscules ni de l'ordre prénom / nom) et qu'aucun autre compte n'a déjà
--    pris ce joueur, le compte est lié à ce joueur et devient joueur.
-- L'admin confirme toujours le compte (a_confirmer) et peut changer son rôle dans Accès (aucun droit en plus :
-- joueur et supporter ont les mêmes accès).

-- « HIVERT  Antoine » et « Antoine Hivert » → « antoine hivert »
create or replace function public.nom_cle(t text) returns text
language sql immutable as $$
  select coalesce(string_agg(w, ' ' order by w), '') from regexp_split_to_table(lower(translate(trim(coalesce(t, '')),
    'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñŸÿ', 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYy')), '\s+') w
  where w <> '';
$$;

-- nom du joueur de nos compos (compos publiques et cachées) qui correspond à ce nom ; l'orthographe la plus utilisée
create or replace function public.joueur_du_nom(p_nom text) returns text
language sql stable security definer set search_path = public as $$
  with cle as (select public.nom_cle(p_nom) k),
  noms as (
    select p->>'name' as nom
      from matches m, jsonb_array_elements(coalesce(m.rosters -> coalesce(m.club_side, 'H'), '[]'::jsonb)) p
    union all
    select p->>'name'
      from compos_privees c join matches m on m.id = c.match_id,
           jsonb_array_elements(coalesce(c.rosters -> coalesce(m.club_side, 'H'), '[]'::jsonb)) p
  )
  select nom from noms, cle
   where cle.k like '% %' and public.nom_cle(nom) = cle.k
   group by nom order by count(*) desc, nom limit 1;
$$;
revoke all on function public.joueur_du_nom(text) from public, anon, authenticated;

create or replace function public.profiles_joueur_reconnu() returns trigger
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  -- vient d'être lié à un joueur des compos : un supporter devient joueur
  if new.joueur is not null and (tg_op = 'INSERT' or old.joueur is null) and new.role = 'supporter' then
    new.role := 'joueur';
  end if;
  -- pas encore lié : son nom est celui d'un joueur de nos compos, que personne d'autre n'a pris
  if new.joueur is null and new.role = 'supporter' and (tg_op = 'INSERT' or new.nom is distinct from old.nom) then
    v := public.joueur_du_nom(new.nom);
    if v is not null and not exists (select 1 from profiles where joueur = v and id <> new.id) then
      new.joueur := v;
      new.role := 'joueur';
    end if;
  end if;
  return new;
end $$;
-- après profiles_format_nom (ordre alphabétique des déclencheurs) : le nom est déjà mis en forme
drop trigger if exists profiles_joueur_reconnu on public.profiles;
create trigger profiles_joueur_reconnu before insert or update of nom, joueur on public.profiles
  for each row execute function public.profiles_joueur_reconnu();

-- comptes déjà créés : supporters liés à un joueur → joueur ; supporters pas liés reconnus par leur nom → liés et joueur
update profiles set role = 'joueur' where role = 'supporter' and joueur is not null;
update profiles p set joueur = x.j
  from (select id, public.joueur_du_nom(nom) j from profiles where role = 'supporter' and joueur is null) x
 where p.id = x.id and x.j is not null
   and not exists (select 1 from profiles o where o.joueur = x.j and o.id <> p.id)
   and (select count(*) from profiles o2 where o2.role = 'supporter' and o2.joueur is null and public.joueur_du_nom(o2.nom) = x.j) = 1;

select role, count(*) as comptes, count(joueur) as lies_a_un_joueur from profiles where role in ('joueur', 'supporter') group by role order by role;
