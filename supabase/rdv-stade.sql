-- Heure de rendez-vous au stade (ligne « RDV au STADE à » de la feuille des convocations), affichée aux personnes connectées
-- au-dessus de la compo jusqu'au coup d'envoi. Envoyée par /api/convocations avec les compos.
alter table public.matches add column if not exists rdv timestamptz;

create or replace function public.convocations_compos(p_cle text, p_data jsonb) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare x jsonb; n int := 0; k int; v_side text; v_roster jsonb;
begin
  if encode(digest(p_cle, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'alerte') then
    raise exception 'clé invalide';
  end if;
  for x in select * from jsonb_array_elements(p_data) loop
    select club_side into v_side from matches where id = (x->>'match_id')::uuid and status = 'prevu';
    if v_side is null then continue; end if;
    -- heure de rendez-vous : toujours mise à jour (avant le coup d'envoi, le jour du match)
    if coalesce(x->>'rdv', '') <> '' then
      update matches m set rdv = (x->>'rdv')::timestamptz
        where m.id = (x->>'match_id')::uuid and m.status = 'prevu'
          and (x->>'rdv')::timestamptz < m.kickoff and (x->>'rdv')::timestamptz > m.kickoff - interval '6 hours'
          and m.rdv is distinct from (x->>'rdv')::timestamptz;
    end if;
    if jsonb_typeof(x->'joueurs') <> 'array' or jsonb_array_length(x->'joueurs') = 0 then continue; end if;
    -- compo cachée déjà saisie : on n'y touche pas
    if exists (select 1 from compos_privees p where p.match_id = (x->>'match_id')::uuid
               and coalesce(jsonb_array_length(p.rosters->v_side), 0) > 0) then continue; end if;
    select coalesce(jsonb_agg(jsonb_build_object('n', '', 'name', left(trim(j), 60), 'sub', false)), '[]'::jsonb) into v_roster
      from jsonb_array_elements_text(x->'joueurs') j where trim(j) <> '';
    update matches m set rosters = jsonb_set(coalesce(m.rosters, '{"H":[],"A":[]}'::jsonb), array[v_side], v_roster)
      where m.id = (x->>'match_id')::uuid and m.status = 'prevu'
        and coalesce(jsonb_array_length(m.rosters->v_side), 0) = 0;
    get diagnostics k = row_count; n := n + k;
  end loop;
  return n;
end $$;
revoke all on function public.convocations_compos(text, jsonb) from public;
grant execute on function public.convocations_compos(text, jsonb) to anon, authenticated;
select 'ok' as rdv_stade;
