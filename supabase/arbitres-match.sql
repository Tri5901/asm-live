-- Arbitres affichés sur la page du match (demande de Tristan, 21/10) :
-- 1) noms des officiels désignés par la FFF (section « OFFICIELS » de la page du match), relevés par la tâche des horaires
--    avec la désignation : matches.arbitres = {"centre": "Prénom Nom", "a1": "…", "a2": "…"} (public, comme sur la FFF) ;
-- 2) bénévoles du club qui ont accepté un poste (délégué, arbitre central, arbitre de touche) : visibles de tous, même sans compte
--    (Tristan, 21/10), présentés comme « bénévoles du club » pour les distinguer des officiels FFF.
alter table public.matches add column if not exists arbitres jsonb;

-- p_data = [{"match_id": "...", "officiels": "central" | "trio", "arbitres": {"centre": "...", "a1": "...", "a2": "..."}}, ...]
create or replace function public.officiels_fff(p_secret text, p_data jsonb) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare x jsonb; m record; v_besoins text[]; v_arb jsonb; n int := 0;
begin
  if encode(digest(p_secret, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'classements') then
    raise exception 'clé invalide';
  end if;
  for x in select * from jsonb_array_elements(coalesce(p_data, '[]')) loop
    if (x->>'officiels') not in ('central', 'trio') then continue; end if;
    select * into m from matches where id = (x->>'match_id')::uuid and status = 'prevu';
    if m is null then continue; end if;
    update matches set officiels_fff_at = now() where id = m.id;
    -- noms des officiels (texte court, seulement les trois postes)
    if jsonb_typeof(x->'arbitres') = 'object' then
      select nullif(jsonb_strip_nulls(jsonb_build_object(
               'centre', nullif(left(trim(x->'arbitres'->>'centre'), 60), ''),
               'a1', nullif(left(trim(x->'arbitres'->>'a1'), 60), ''),
               'a2', nullif(left(trim(x->'arbitres'->>'a2'), 60), ''))), '{}'::jsonb) into v_arb;
      if v_arb is distinct from m.arbitres then
        update matches set arbitres = v_arb where id = m.id;
        if m.officiels is not distinct from (x->>'officiels') then n := n + 1; end if;
      end if;
    end if;
    if m.officiels is not distinct from (x->>'officiels') then continue; end if;
    update matches set officiels = x->>'officiels' where id = m.id;
    v_besoins := public.officiels_besoins(m.club_side, x->>'officiels');
    update officiels_affect set statut = 'retire', updated_at = now()
     where match_id = m.id and not (poste = any(v_besoins)) and notif_at is not null and statut in ('propose', 'confirme');
    delete from officiels_affect where match_id = m.id and not (poste = any(v_besoins)) and statut <> 'retire';
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.officiels_fff(text, jsonb) from public;
grant execute on function public.officiels_fff(text, jsonb) to anon, authenticated;

-- bénévoles du club ayant accepté un poste sur ce match : [{"poste": "central", "nom": "Prénom Nom"}, ...]
create or replace function public.arbitres_club(p_match uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('poste', a.poste, 'nom', p.nom)
           order by array_position(array['central', 'touche', 'delegue'], a.poste)), '[]'::jsonb)
    from officiels_affect a join profiles p on p.id = a.user_id
   where a.match_id = p_match and a.statut = 'confirme';
$$;
revoke all on function public.arbitres_club(uuid) from public;
grant execute on function public.arbitres_club(uuid) to anon, authenticated;
select 'ok' as arbitres_match;
