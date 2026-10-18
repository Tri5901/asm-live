-- Cartons adverses relevés sur la feuille FFF : la minute de la feuille n'est pas toujours celle notée au match
-- (18/10, B à Plessé : carton blanc du n°13 noté à la 64e, la FFF dit 63e → ajouté en double).
-- Un carton adverse du même type est maintenant considéré comme déjà noté à 5 minutes près, pour le même joueur
-- (ou si l'un des deux n'a pas de numéro).
create or replace function public.ajout_carton_adverse(p_secret text, p_match uuid, p_n text, p_min text, p_p int, p_k text default 'yellow')
returns int language plpgsql security definer set search_path = public, extensions as $$
declare v_side text; v_sort numeric; v_n text; k int;
begin
  if encode(digest(p_secret, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'classements') then
    raise exception 'clé invalide';
  end if;
  if p_k not in ('yellow', 'white', 'red') then return 0; end if;
  select case when club_side = 'A' then 'H' else 'A' end into v_side from matches where id = p_match and status = 'termine';
  if v_side is null or p_p not in (1, 2) or coalesce(p_min, '') !~ '^\d{1,3}(\+\d{1,2})?''$' then return 0; end if;
  v_sort := (regexp_match(p_min, '^(\d+)'))[1]::numeric + coalesce((regexp_match(p_min, '\+(\d+)'))[1]::numeric / 100, 0);
  v_n := nullif(left(trim(coalesce(p_n, '')), 3), '');
  insert into events (id, match_id, t, k, n, min, sort, p, created_by)
  select gen_random_uuid(), p_match, v_side, p_k, v_n, p_min, v_sort, p_p,
         (select id from profiles where proprietaire limit 1)
  where not exists (select 1 from events e where e.match_id = p_match and e.t = v_side and e.k = p_k
                      and (e.min = p_min or (abs(e.sort - v_sort) <= 5 and (e.n is null or v_n is null or e.n = v_n))));
  get diagnostics k = row_count;
  return k;
end $$;
revoke all on function public.ajout_carton_adverse(text, uuid, text, text, int, text) from public;
grant execute on function public.ajout_carton_adverse(text, uuid, text, text, int, text) to anon, authenticated;

-- le doublon du 18/10 (celui ajouté depuis la feuille FFF, 63e) ; celui saisi au match (64e) est gardé
delete from events where id = 'eef8881d-02d7-4d84-98f2-669128f9a997'
  and match_id = 'c0d3c579-370c-4a03-a462-48250588d920' and k = 'white' and min = '63''';

select count(*) as cartons_blancs_b from events where match_id = 'c0d3c579-370c-4a03-a462-48250588d920' and k = 'white';
