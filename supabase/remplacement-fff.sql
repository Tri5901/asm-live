-- Remplacements de l'équipe adverse pas saisis pendant le match, relevés ensuite sur la feuille de match FFF
-- (tâche programmée, clé des classements). N'ajoute qu'un remplacement adverse, sur un match terminé,
-- et rien s'il est déjà noté (même sortant et même entrant). Le reste de la chronologie n'est jamais modifié.
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
  where not exists (select 1 from events e where e.match_id = p_match and e.t = v_side and e.k = 'sub' and e.out_n = p_out and e.in_n = p_in);
  get diagnostics k = row_count;
  return k;
end $$;
revoke all on function public.ajout_remplacement_adverse(text, uuid, text, text, text, int) from public;
grant execute on function public.ajout_remplacement_adverse(text, uuid, text, text, text, int) to anon, authenticated;
select 'ok' as remplacement_fff;
