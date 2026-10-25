-- Comptes reliés à leur joueur même après coup (Tristan, 25/10 : Clara Percy Du Sert n'était pas reliée).
-- Avant : reconnaissance seulement à la création du compte ou quand la personne change de nom, et seulement pour un
-- supporter ; un nom complété plus tard dans les compos (« Clara P. » → « Clara Percy Du Sert ») ne reliait rien.
-- Maintenant : tout compte actif pas encore relié l'est dès que son nom complet apparaît dans une compo (sans tenir compte
-- des accents, des majuscules ni de l'ordre prénom / nom), à condition qu'un seul compte porte ce nom et que personne
-- n'ait déjà pris ce joueur. Le rôle ne change que pour un supporter (→ joueur) ; « joueur » s'ajoute aux rôles cumulés.

-- relie les comptes dont le nom fait partie de ces noms de joueurs ; renvoie le nombre de comptes reliés
create or replace function public.lier_par_noms(p_noms text[]) returns int
language plpgsql security definer set search_path = public as $$
declare r record; v text; n int := 0;
begin
  for r in select p.id, p.nom, public.nom_cle(p.nom) k from profiles p
            where p.joueur is null and p.role not in ('supprime', 'pending') and not coalesce(p.efface, false) and p.nom like '% %'
              and public.nom_cle(p.nom) in (select public.nom_cle(x) from unnest(p_noms) x where x like '% %') loop
    -- deux comptes au même nom : on ne devine pas lequel est le joueur
    if (select count(*) from profiles q where q.role <> 'supprime' and public.nom_cle(q.nom) = r.k) > 1 then continue; end if;
    v := public.joueur_du_nom(r.nom);
    if v is null or exists (select 1 from profiles where joueur = v) then continue; end if;
    update profiles set joueur = v where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.lier_par_noms(text[]) from public, anon, authenticated;

-- compo enregistrée, importée, renommée ou fusionnée : on regarde seulement les noms de notre côté de ce match
create or replace function public.matches_lier_joueurs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.lier_par_noms(array(select e->>'name' from jsonb_array_elements(coalesce(new.rosters -> coalesce(new.club_side, 'H'), '[]'::jsonb)) e));
  return null;
end $$;
create or replace function public.compos_privees_lier_joueurs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.lier_par_noms(array(select e->>'name' from matches m, jsonb_array_elements(coalesce(new.rosters -> coalesce(m.club_side, 'H'), '[]'::jsonb)) e where m.id = new.match_id));
  return null;
end $$;
drop trigger if exists matches_lier_joueurs_ajout on public.matches;
create trigger matches_lier_joueurs_ajout after insert on public.matches
  for each row when (new.rosters is not null) execute function public.matches_lier_joueurs();
drop trigger if exists matches_lier_joueurs_maj on public.matches;
create trigger matches_lier_joueurs_maj after update of rosters on public.matches
  for each row when (new.rosters is distinct from old.rosters) execute function public.matches_lier_joueurs();
drop trigger if exists compos_privees_lier_joueurs on public.compos_privees;
create trigger compos_privees_lier_joueurs after insert or update of rosters on public.compos_privees
  for each row execute function public.compos_privees_lier_joueurs();

-- création du compte / nouveau nom : même règle pour tous les comptes actifs (avant : seulement les supporters)
create or replace function public.profiles_joueur_reconnu() returns trigger
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  -- vient d'être lié à un joueur des compos : un supporter devient joueur
  if new.joueur is not null and (tg_op = 'INSERT' or old.joueur is null) and new.role = 'supporter' then
    new.role := 'joueur';
  end if;
  -- pas encore lié : son nom est celui d'un joueur de nos compos, que personne d'autre n'a pris
  if new.joueur is null and new.role not in ('supprime', 'pending') and (tg_op = 'INSERT' or new.nom is distinct from old.nom) then
    v := public.joueur_du_nom(new.nom);
    if v is not null and not exists (select 1 from profiles where joueur = v and id <> new.id)
       and not exists (select 1 from profiles q where q.id <> new.id and q.role <> 'supprime' and public.nom_cle(q.nom) = public.nom_cle(new.nom)) then
      new.joueur := v;
      if new.role = 'supporter' then new.role := 'joueur'; end if;
    end if;
  end if;
  return new;
end $$;

-- comptes déjà créés : tous les noms de nos compos (publiques et cachées)
select public.lier_par_noms(array(
  select e->>'name' from matches m, jsonb_array_elements(coalesce(m.rosters -> coalesce(m.club_side, 'H'), '[]'::jsonb)) e
  union
  select e->>'name' from compos_privees c join matches m on m.id = c.match_id, jsonb_array_elements(coalesce(c.rosters -> coalesce(m.club_side, 'H'), '[]'::jsonb)) e
)) as comptes_relies;
