-- Cartons adverses oubliés (relevés sur la feuille FFF) : jaune, blanc ou rouge. Même règle qu'avant :
-- match terminé seulement, rien si un carton adverse du même type existe déjà à cette minute, rien d'autre n'est modifié.
drop function if exists public.ajout_carton_adverse(text, uuid, text, text, int);
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
  where not exists (select 1 from events e where e.match_id = p_match and e.t = v_side and e.k = p_k and e.min = p_min);
  get diagnostics k = row_count;
  return k;
end $$;
revoke all on function public.ajout_carton_adverse(text, uuid, text, text, int, text) from public;
grant execute on function public.ajout_carton_adverse(text, uuid, text, text, int, text) to anon, authenticated;
select 'ok' as carton_fff_types;
