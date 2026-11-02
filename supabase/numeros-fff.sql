-- Numéros de NOS joueurs repris de la feuille de match FFF (tâche programmée du dimanche, clé des classements).
-- Quand la compo a été saisie sans tous les numéros (Tristan, 02/11 : « tu peux les récupérer sur la feuille de match »).
-- Un joueur est reconnu par son prénom + l'initiale de son nom (la FFF écrit « ROMAIN R. »), sans accents ni majuscules,
-- et seulement s'il est seul à porter cette clé, dans notre compo comme sur la feuille. Ne fait que :
--   - donner son numéro FFF à un joueur qui n'en a pas (si ce numéro n'est pas déjà pris dans la compo) ;
--   - corriger titulaire / remplaçant quand le numéro saisi est le même que sur la feuille.
-- Aucun nom, aucun autre numéro n'est modifié. Compo cachée : rien.
create or replace function public.cle_fff(t text) returns text language sql immutable as $$
  select translate(lower(split_part(w, ' ', 1)), 'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc') || ' ' ||
         translate(lower(left(split_part(w, ' ', 2), 1)), 'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc')
  from (select regexp_replace(trim(coalesce(t, '')), '\s+', ' ', 'g') as w) s $$;

-- p_joueurs = notre équipe sur la feuille FFF : [{"n":"7","name":"Romain R.","sub":false}, ...]
create or replace function public.numeros_fff(p_secret text, p_match uuid, p_joueurs jsonb) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare v_side text; v_roster jsonb; v_new jsonb := '[]'; e jsonb; f jsonb; cle text; nf int; nr int; nb int := 0;
begin
  if encode(digest(p_secret, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'classements') then
    raise exception 'clé invalide';
  end if;
  select club_side, rosters->club_side into v_side, v_roster from matches
    where id = p_match and status = 'termine' and not coalesce(compo_cachee, false);
  if v_roster is null or jsonb_typeof(v_roster) <> 'array' or jsonb_typeof(p_joueurs) <> 'array' then return 0; end if;
  for e in select j.x from jsonb_array_elements(v_roster) with ordinality j(x, o) order by j.o loop
    cle := cle_fff(e->>'name');
    select count(*) into nf from jsonb_array_elements(p_joueurs) j(x) where cle_fff(j.x->>'name') = cle;
    select count(*) into nr from jsonb_array_elements(v_roster) j(x) where cle_fff(j.x->>'name') = cle;
    if cle !~ '^\S+ \S$' or nf <> 1 or nr <> 1 then v_new := v_new || jsonb_build_array(e); continue; end if;
    select j.x into f from jsonb_array_elements(p_joueurs) j(x) where cle_fff(j.x->>'name') = cle;
    if coalesce(e->>'n', '') = '' and coalesce(f->>'n', '') ~ '^\d{1,3}$'
       and not exists (select 1 from jsonb_array_elements(v_roster) j(x) where j.x->>'n' = f->>'n') then
      e := e || jsonb_build_object('n', f->>'n', 'sub', coalesce((f->>'sub')::boolean, false)); nb := nb + 1;
    elsif e->>'n' = f->>'n' and coalesce((e->>'sub')::boolean, false) is distinct from coalesce((f->>'sub')::boolean, false) then
      e := e || jsonb_build_object('sub', coalesce((f->>'sub')::boolean, false)); nb := nb + 1;
    end if;
    v_new := v_new || jsonb_build_array(e);
  end loop;
  if nb > 0 then update matches set rosters = jsonb_set(rosters, array[v_side], v_new) where id = p_match; end if;
  return nb;
end $$;
revoke all on function public.numeros_fff(text, uuid, jsonb) from public;
grant execute on function public.numeros_fff(text, uuid, jsonb) to anon, authenticated;

-- Doublons (C du 01/11) : un remplacement ou un carton adverse saisi pendant le match avec d'autres numéros
-- était rajouté une 2e fois depuis la feuille FFF. Désormais rien n'est ajouté si, à 3 minutes près, le même côté a déjà :
--   - un remplacement où l'un des deux numéros apparaît (dans un sens ou dans l'autre) ;
--   - un carton du même type.
create or replace function public.ajout_remplacement_adverse(p_secret text, p_match uuid, p_out text, p_in text, p_min text, p_p int)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare v_side text; v_sort numeric; k int;
begin
  if encode(digest(p_secret, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'classements') then
    raise exception 'clé invalide';
  end if;
  select case when club_side = 'A' then 'H' else 'A' end into v_side from matches where id = p_match and status = 'termine';
  if v_side is null or p_p not in (1, 2) or coalesce(p_min, '') !~ '^\d{1,3}(\+\d{1,2})?''$'
     or coalesce(p_out, '') !~ '^\d{1,3}$' or coalesce(p_in, '') !~ '^\d{1,3}$' then return 0; end if;
  v_sort := (regexp_match(p_min, '^(\d+)'))[1]::numeric + coalesce((regexp_match(p_min, '\+(\d+)'))[1]::numeric / 100, 0);
  insert into events (id, match_id, t, k, out_n, in_n, min, sort, p, created_by)
  select gen_random_uuid(), p_match, v_side, 'sub', p_out, p_in, p_min, v_sort, p_p, (select id from profiles where proprietaire limit 1)
  where not exists (select 1 from events e where e.match_id = p_match and e.t = v_side and e.k = 'sub'
    and ((e.out_n = p_out and e.in_n = p_in)
      or (abs(e.sort - v_sort) <= 3 and (e.in_n in (p_in, p_out) or e.out_n in (p_in, p_out)))));
  get diagnostics k = row_count;
  return k;
end $$;
revoke all on function public.ajout_remplacement_adverse(text, uuid, text, text, text, int) from public;
grant execute on function public.ajout_remplacement_adverse(text, uuid, text, text, text, int) to anon, authenticated;

create or replace function public.ajout_carton_adverse(p_secret text, p_match uuid, p_n text, p_min text, p_p int, p_k text default 'yellow')
returns int language plpgsql security definer set search_path = public, extensions as $$
declare v_side text; v_sort numeric; k int;
begin
  if encode(digest(p_secret, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'classements') then
    raise exception 'clé invalide';
  end if;
  if p_k not in ('yellow', 'white', 'red') then return 0; end if;
  select case when club_side = 'A' then 'H' else 'A' end into v_side from matches where id = p_match and status = 'termine';
  if v_side is null or p_p not in (1, 2) or coalesce(p_min, '') !~ '^\d{1,3}(\+\d{1,2})?''$' then return 0; end if;
  v_sort := (regexp_match(p_min, '^(\d+)'))[1]::numeric + coalesce((regexp_match(p_min, '\+(\d+)'))[1]::numeric / 100, 0);
  insert into events (id, match_id, t, k, n, min, sort, p, created_by)
  select gen_random_uuid(), p_match, v_side, p_k, nullif(left(trim(coalesce(p_n, '')), 3), ''), p_min, v_sort, p_p,
         (select id from profiles where proprietaire limit 1)
  where not exists (select 1 from events e where e.match_id = p_match and e.t = v_side and e.k = p_k
    and (e.min = p_min or abs(e.sort - v_sort) <= 3));
  get diagnostics k = row_count;
  return k;
end $$;
revoke all on function public.ajout_carton_adverse(text, uuid, text, text, int, text) from public;
grant execute on function public.ajout_carton_adverse(text, uuid, text, text, int, text) to anon, authenticated;
select 'ok' as numeros_fff;
