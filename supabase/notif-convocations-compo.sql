-- Tristan, 15/11 :
--  1. notification aux abonnés d'une équipe à la sortie des convocations (import de la feuille du club, une seule fois par match) ;
--  2. notification « la compo est là » ~15 min avant le coup d'envoi si notre compo est complète (une seule fois) ;
--  3. vue terrain activée d'office quand tous nos joueurs sont mis avec leur numéro (sauf si quelqu'un l'a déjà activée ou coupée) ;
--  4. vérification des convocations en plus le samedi à 22 h 45 (heure de Paris).
alter table public.matches add column if not exists convoc_notif_at timestamptz;
alter table public.matches add column if not exists compo_notif_at timestamptz;

-- compo complète : autant de titulaires numérotés que de joueurs sur le terrain (11, ou 8 au foot à 8), et tout le monde a un numéro
create or replace function public.compo_complete(p_rosters jsonb, p_side text, p_equipe int) returns boolean
language sql stable set search_path = public as $$
  select count(*) filter (where not coalesce((j->>'sub')::boolean, false) and coalesce(trim(j->>'n'), '') <> '')
           = coalesce((select joueurs from equipes where id = p_equipe), 11)
     and count(*) filter (where coalesce(trim(j->>'n'), '') = '') = 0
    from jsonb_array_elements(case when jsonb_typeof(p_rosters -> coalesce(p_side, 'H')) = 'array'
                                   then p_rosters -> coalesce(p_side, 'H') else '[]'::jsonb end) j
   where coalesce(trim(j->>'name'), '') <> '' or coalesce(trim(j->>'n'), '') <> ''
$$;
revoke all on function public.compo_complete(jsonb, text, int) from public;

-- 3. vue terrain d'office : match à venir ou en direct, compo publique complète, foot à 11 ou à 8, « on » jamais choisi
--    (passe après la compo cachée, qui rend la compo publique au coup d'envoi)
create or replace function public.terrain_auto_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare t jsonb := case when jsonb_typeof(new.terrain) = 'object' then new.terrain else '{}'::jsonb end;
begin
  if new.status in ('prevu', 'direct') and not coalesce(new.compo_cachee, false) and not t ? 'on'
     and coalesce((select joueurs from equipes where id = new.equipe), 11) in (8, 11)
     and public.compo_complete(new.rosters, new.club_side, new.equipe) then
    new.terrain := t || '{"on": true}'::jsonb;
  end if;
  return new;
end $$;
drop trigger if exists matches_zzz_terrain_auto on public.matches;
create trigger matches_zzz_terrain_auto before update on public.matches for each row execute function public.terrain_auto_trg();

-- 1. convocations sorties : appelé par /api/convocations avec les matchs dont la convocation vient d'être lue ;
--    marque chaque match (une seule fois) et renvoie les abonnés de l'équipe
create or replace function public.convoc_targets(p_cle text, p_matches uuid[])
returns table(endpoint text, p256dh text, auth text, match_id uuid)
language plpgsql security definer set search_path = public, extensions as $$
begin
  if encode(digest(p_cle, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'alerte') then
    raise exception 'clé invalide';
  end if;
  return query with marques as (
      update matches x set convoc_notif_at = now()
       where x.id = any(p_matches) and x.convoc_notif_at is null and x.status = 'prevu'
         and x.kickoff between now() and now() + interval '4 days'
      returning x.id, x.equipe)
    select s.endpoint, s.p256dh, s.auth, mq.id from marques mq join push_subscriptions s on mq.equipe = any(s.equipes);
end $$;
revoke all on function public.convoc_targets(text, uuid[]) from public;
grant execute on function public.convoc_targets(text, uuid[]) to anon, authenticated;

-- 2. « la compo est là » : appelé par /api/alerte-score (toutes les 10 min le week-end), entre 20 min avant et le coup d'envoi,
--    compo publique complète (pas pour une compo cachée), une seule fois ; pas de noms pour une catégorie anonymisée
create or replace function public.compo_publique_targets(p_cle text)
returns table(endpoint text, p256dh text, auth text, titre text, texte text, url text, tag text)
language plpgsql security definer set search_path = public, extensions as $$
declare m record; v_tit text; v_anon boolean; v_nous text;
begin
  if encode(digest(p_cle, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'alerte') then
    raise exception 'clé invalide';
  end if;
  for m in select x.id, x.equipe, x.home_name, x.away_name, x.kickoff, x.club_side, x.rosters
             from matches x
            where x.status = 'prevu' and x.compo_notif_at is null and not coalesce(x.compo_cachee, false)
              and x.kickoff between now() and now() + interval '20 minutes' loop
    if not public.compo_complete(m.rosters, m.club_side, m.equipe) then continue; end if;
    update matches set compo_notif_at = now() where id = m.id;
    v_anon := coalesce((select e.anonyme from equipes e where e.id = m.equipe), false);
    select string_agg(trim(j->>'name'), ', ' order by case when j->>'n' ~ '^\d+$' then (j->>'n')::int else 999 end) into v_tit
      from jsonb_array_elements(m.rosters -> coalesce(m.club_side, 'H')) j
     where not coalesce((j->>'sub')::boolean, false) and coalesce(trim(j->>'name'), '') <> '';
    v_nous := case when coalesce(m.club_side, 'H') = 'H' then m.home_name else m.away_name end;
    return query select distinct on (s.endpoint) s.endpoint, s.p256dh, s.auth,
        ('📋 La compo est là · ' || v_nous)::text,
        ('Coup d''envoi à ' || to_char(m.kickoff at time zone 'Europe/Paris', 'HH24"h"MI') || ' · ' || m.home_name || ' – ' || m.away_name || E'\n'
          || case when v_anon or v_tit is null then 'Découvre les titulaires dans l''appli.' else 'Titulaires : ' || v_tit end)::text,
        ('/#/match/' || m.id::text)::text, ('compo-' || m.id::text)::text
      from push_subscriptions s where m.equipe = any(s.equipes);
  end loop;
end $$;
revoke all on function public.compo_publique_targets(text) from public;
grant execute on function public.compo_publique_targets(text) to anon, authenticated;

-- 4. samedi 22 h 45 à Paris : 20 h 45 UTC l'été, 21 h 45 UTC l'hiver (l'appli ne garde que 22 h 30-22 h 59 à Paris) ;
--    même appel que le minuteur « convocations » (clé comprise)
select cron.unschedule('convocations-samedi-soir') where exists (select 1 from cron.job where jobname = 'convocations-samedi-soir');
select cron.schedule('convocations-samedi-soir', '45 20,21 * * 6', (select command from cron.job where jobname = 'convocations'));

-- matchs déjà complets qui attendent : vue terrain tout de suite
update matches x set terrain = case when jsonb_typeof(x.terrain) = 'object' then x.terrain else '{}'::jsonb end || '{"on": true}'::jsonb
 where x.status = 'prevu' and not coalesce(x.compo_cachee, false)
   and not (case when jsonb_typeof(x.terrain) = 'object' then x.terrain else '{}'::jsonb end) ? 'on'
   and coalesce((select joueurs from equipes where id = x.equipe), 11) in (8, 11)
   and public.compo_complete(x.rosters, x.club_side, x.equipe);
select 'ok' as notif_convocations_compo;
