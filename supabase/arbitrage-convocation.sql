-- Arbitrage lu sur les convocations du club (vendredi soir / samedi, api/convocations.js) : lignes « Arbitre »,
-- « Arbitre de touche » et « Police de terrain » de chaque équipe → matches.arbitrage =
-- {"arbitre": "officiel" | "adversaire" | "Prénom Nom", "touche": …, "police": …} (affiché sur la page du match, Tristan 21/10).
alter table public.matches add column if not exists arbitrage jsonb;

create or replace function public.convocations_compos(p_cle text, p_data jsonb) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare x jsonb; n int := 0; k int; v_side text; v_roster jsonb; v_arb jsonb;
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
    -- arbitrage de la convocation : toujours mis à jour (la convocation fait foi jusqu'au match)
    if jsonb_typeof(x->'arbitrage') = 'object' then
      select nullif(jsonb_strip_nulls(jsonb_build_object(
               'arbitre', nullif(left(trim(x->'arbitrage'->>'arbitre'), 60), ''),
               'touche', nullif(left(trim(x->'arbitrage'->>'touche'), 60), ''),
               'police', nullif(left(trim(x->'arbitrage'->>'police'), 60), ''))), '{}'::jsonb) into v_arb;
      update matches m set arbitrage = v_arb
        where m.id = (x->>'match_id')::uuid and m.status = 'prevu' and m.arbitrage is distinct from v_arb;
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
select 'ok' as arbitrage_convocation;
