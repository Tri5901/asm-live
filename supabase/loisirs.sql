-- Équipe Loisirs (SportEasy « AS Mésanger Loisirs », as-mesanger-loisirs.sporteasy.net) — préparé le 24/10,
-- à appliquer quand on aura le lien du calendrier SportEasy (synchronisation .ics).
-- Leurs matchs ne sont pas sur la FFF : ils viennent du calendrier SportEasy (scripts/loisirs-sporteasy.js).
-- Pas de classement FFF (fff_classement vide) : l'équipe n'apparaît pas dans les Classements, mais bien dans
-- les matchs, les stats et le choix des notifications.

-- identifiant de l'événement dans sa source (« sporteasy:<UID> ») : un match n'est jamais créé deux fois
alter table public.matches add column if not exists ext_id text;
create unique index if not exists matches_ext_id on public.matches(ext_id) where ext_id is not null;

insert into public.equipes (id, categorie, cat_ordre, ordre, nom, court, nom_club, fff_classement, actif, fff_poule, mi_temps, joueurs, exceptionnelle, niveau)
values (8, 'Loisirs', 4, 1, 'Loisirs', 'L', 'AS Mésanger Loisirs', null, true, null, 45, 11, false, 'Loisirs')
on conflict (id) do nothing;

-- p_data = [{ "uid", "kickoff", "club_side": "H"|"A", "adversaire", "competition", "lieu", "adresse" }]
-- Nouveau match : ajouté ; match à venir déjà connu : date, adversaire, lieu mis à jour s'ils ont changé.
-- Un match commencé ou terminé n'est plus touché. Rien n'est jamais supprimé (match annulé : à voir à la main).
create or replace function public.loisirs_sync(p_secret text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare x jsonb; v_ext text; v_id uuid; v_status text; v_nous text; v_adv text; v_home text; v_away text;
        n_ajout int := 0; n_maj int := 0; k int;
begin
  if encode(digest(p_secret, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'classements') then
    raise exception 'clé invalide';
  end if;
  select nom_club into v_nous from equipes where id = 8;
  if v_nous is null then raise exception 'équipe Loisirs absente'; end if;
  for x in select * from jsonb_array_elements(p_data) loop
    if coalesce(x->>'uid', '') = '' or x->>'club_side' not in ('H', 'A') or (x->>'kickoff') is null then continue; end if;
    v_ext := 'sporteasy:' || left(x->>'uid', 200);
    v_adv := left(coalesce(nullif(trim(x->>'adversaire'), ''), 'Adversaire à déterminer'), 60);
    v_home := case when x->>'club_side' = 'H' then v_nous else v_adv end;
    v_away := case when x->>'club_side' = 'H' then v_adv else v_nous end;
    select id, status into v_id, v_status from matches where ext_id = v_ext;
    if v_id is null then
      insert into matches (kickoff, competition, equipe, club_side, home_name, away_name, lieu, adresse, ext_id)
      values ((x->>'kickoff')::timestamptz, left(coalesce(nullif(x->>'competition', ''), 'Loisirs'), 80), 8, x->>'club_side',
              v_home, v_away, nullif(left(x->>'lieu', 120), ''), nullif(left(x->>'adresse', 200), ''), v_ext);
      n_ajout := n_ajout + 1;
    elsif v_status = 'prevu' then
      update matches set kickoff = (x->>'kickoff')::timestamptz, club_side = x->>'club_side', home_name = v_home, away_name = v_away,
             competition = left(coalesce(nullif(x->>'competition', ''), competition), 80),
             lieu = coalesce(nullif(left(x->>'lieu', 120), ''), lieu), adresse = coalesce(nullif(left(x->>'adresse', 200), ''), adresse)
        where id = v_id
          and (kickoff, club_side, home_name, away_name, competition, lieu, adresse) is distinct from
              ((x->>'kickoff')::timestamptz, x->>'club_side', v_home, v_away, left(coalesce(nullif(x->>'competition', ''), competition), 80),
               coalesce(nullif(left(x->>'lieu', 120), ''), lieu), coalesce(nullif(left(x->>'adresse', 200), ''), adresse));
      get diagnostics k = row_count; n_maj := n_maj + k;
    end if;
  end loop;
  return jsonb_build_object('ajouts', n_ajout, 'maj', n_maj);
end $$;
revoke all on function public.loisirs_sync(text, jsonb) from public;
grant execute on function public.loisirs_sync(text, jsonb) to anon, authenticated;
select 'ok' as loisirs;
