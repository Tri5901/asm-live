-- Loisirs : scores et classement relevés sur SportEasy (scripts/loisirs-resultats.js), le calendrier .ics n'ayant pas les scores.
-- p_data = { "matchs": [{ "uid", "kickoff", "club_side", "adversaire", "competition", "lieu", "adresse", "opp_logo", "bH", "bA" }],
--            "classement": { "lignes": [[rang, nom, pts, J, G, N, P, bp, bc, diff, code]], "resultats": [[id, date, codeDom, nomDom, bH, bA, codeExt, nomExt]] } }
-- Nos matchs (joués depuis plus de 2 h) : absent du site → ajouté terminé avec son score ; encore « à venir » (personne ne l'a
-- saisi en direct) → passé terminé avec son score ; commencé ou terminé dans l'appli → jamais touché (la saisie en direct fait foi).
-- Les buts sont ajoutés sans buteur ni minute, comme les matchs des jeunes repris de la FFF. Aucune notification ne part
-- (match jamais « en direct »). Classement : remplacé à chaque relevé, source « SportEasy ».
create or replace function public.loisirs_resultats(p_secret text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare x jsonb; v_ext text; v_id uuid; v_status text; v_nous text; v_adv text; v_mt int; v_bh int; v_ba int;
        n_ajout int := 0; n_score int := 0; n_saisi int := 0; v_cls boolean := false;
begin
  if encode(digest(p_secret, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'classements') then
    raise exception 'clé invalide';
  end if;
  select nom_club, coalesce(mi_temps, 45) into v_nous, v_mt from equipes where id = 8;
  if v_nous is null then raise exception 'équipe Loisirs absente'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_data->'matchs', '[]'::jsonb)) loop
    if coalesce(x->>'uid', '') = '' or x->>'club_side' not in ('H', 'A') or (x->>'kickoff') is null
       or coalesce(x->>'bH', '') !~ '^\d{1,2}$' or coalesce(x->>'bA', '') !~ '^\d{1,2}$'
       or (x->>'kickoff')::timestamptz > now() - interval '2 hours' then continue; end if;
    v_ext := 'sporteasy:' || left(x->>'uid', 200);
    v_adv := left(coalesce(nullif(trim(x->>'adversaire'), ''), 'Adversaire'), 60);
    v_bh := (x->>'bH')::int; v_ba := (x->>'bA')::int;
    v_id := null; v_status := null;
    select id, status into v_id, v_status from matches where ext_id = v_ext;
    if v_id is null then
      insert into matches (kickoff, competition, equipe, club_side, home_name, away_name, lieu, adresse, ext_id, opp_logo,
                           status, period, running, started_at, acc, half)
      values ((x->>'kickoff')::timestamptz, left(coalesce(nullif(x->>'competition', ''), 'Loisirs'), 80), 8, x->>'club_side',
              case when x->>'club_side' = 'H' then v_nous else v_adv end, case when x->>'club_side' = 'H' then v_adv else v_nous end,
              nullif(left(x->>'lieu', 120), ''), nullif(left(x->>'adresse', 200), ''), v_ext,
              nullif(left(x->>'opp_logo', 200), ''), 'termine', 2, false, 0, v_mt * 60000, v_mt)
      returning id into v_id;
      n_ajout := n_ajout + 1;
    elsif v_status = 'prevu' and not exists (select 1 from events where match_id = v_id) then
      update matches set status = 'termine', period = 2, running = false, started_at = 0, acc = v_mt * 60000 where id = v_id;
      n_score := n_score + 1;
    else
      n_saisi := n_saisi + 1;
      continue;
    end if;
    insert into events (id, match_id, t, k, n, min, sort, p)
    select gen_random_uuid(), v_id, s.t, 'goal', null, '', 0, 1
      from (select 'H' as t, generate_series(1, v_bh) union all select 'A', generate_series(1, v_ba)) s(t, i);
  end loop;
  if jsonb_typeof(p_data->'classement'->'lignes') = 'array' and jsonb_array_length(p_data->'classement'->'lignes') >= 2 then
    insert into classements (equipe, competition, lignes, resultats, source, updated_at)
    values (8, 'Championnat loisirs', p_data->'classement'->'lignes', coalesce(p_data->'classement'->'resultats', '[]'::jsonb), 'SportEasy', now())
    on conflict (equipe) do update set competition = excluded.competition, lignes = excluded.lignes,
      resultats = excluded.resultats, source = excluded.source, updated_at = now();
    v_cls := true;
  end if;
  return jsonb_build_object('ajoutes', n_ajout, 'scores', n_score, 'deja_saisis', n_saisi, 'classement', v_cls);
end $$;
revoke all on function public.loisirs_resultats(text, jsonb) from public;
grant execute on function public.loisirs_resultats(text, jsonb) to anon, authenticated;
select 'ok' as loisirs_resultats;
