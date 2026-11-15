-- Tristan, 15/11 (suite de notif-convocations-compo.sql) :
--  1. compo cachée rendue visible par tous 15 min avant le coup d'envoi (au lieu du coup d'envoi), sauf catégorie anonymisée ;
--  2. notification « la compo est là » à 15 min : le minuteur de chaque minute du week-end (« debut-match ») appelle aussi l'API
--     dès qu'une compo complète est à annoncer ;
--  3. la vue terrain s'allume aussi quand une compo cachée devient visible, si elle est complète (le « on » public valait false
--     faute de pouvoir l'activer tant qu'elle était cachée) ;
--  4. la 2e vérification des convocations est le VENDREDI à 22 h 45 (l'heure où elles sortent souvent), pas le samedi.

-- 3. vue terrain d'office
create or replace function public.terrain_auto_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare t jsonb := case when jsonb_typeof(new.terrain) = 'object' then new.terrain else '{}'::jsonb end;
begin
  if new.status in ('prevu', 'direct') and not coalesce(new.compo_cachee, false)
     and (not t ? 'on' or (coalesce(old.compo_cachee, false) and t->>'on' = 'false'))
     and coalesce((select joueurs from equipes where id = new.equipe), 11) in (8, 11)
     and public.compo_complete(new.rosters, new.club_side, new.equipe) then
    new.terrain := t || '{"on": true}'::jsonb;
  end if;
  return new;
end $$;

-- 2. « la compo est là » : à partir de 15 min avant le coup d'envoi (au lieu de 20)
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
              and x.kickoff between now() and now() + interval '15 minutes' loop
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

-- 1. compo cachée visible 15 min avant (minuteur de chaque minute ; le déclencheur de compo cachée la ressort avec sa vue terrain)
select cron.unschedule('compo-visible') where exists (select 1 from cron.job where jobname = 'compo-visible');
select cron.schedule('compo-visible', '* * * * *', $c$ update public.matches m set compo_cachee = false
  where m.compo_cachee and m.status = 'prevu' and m.kickoff <= now() + interval '15 minutes'
    and not coalesce((select e.anonyme from public.equipes e where e.id = m.equipe), false) $c$);

-- 2. minuteur « debut-match » (chaque minute le week-end) : appelle aussi l'API quand une compo complète est à annoncer
--    (on garde son appel tel quel, clé comprise, et on complète seulement sa condition)
select cron.alter_job(j.jobid, command := left(j.command, strpos(j.command, 'where exists') - 1)
  || $w$where exists (select 1 from public.matches where status = 'direct' and debut_notifie_at is null
    and direct_at between now() - interval '15 minutes' and now() - interval '35 seconds')
  or exists (select 1 from public.matches x where x.status = 'prevu' and x.compo_notif_at is null and not x.compo_cachee
    and x.kickoff between now() and now() + interval '15 minutes' and public.compo_complete(x.rosters, x.club_side, x.equipe))$w$)
  from cron.job j where j.jobname = 'debut-match' and strpos(j.command, 'where exists') > 0 and strpos(j.command, 'compo_notif_at') = 0;

-- 4. vendredi 22 h 45 à Paris : 20 h 45 UTC l'été, 21 h 45 UTC l'hiver (l'appli garde ven. 22 h 30-22 h 59 et 23 h 00-23 h 29)
select cron.unschedule('convocations-samedi-soir') where exists (select 1 from cron.job where jobname = 'convocations-samedi-soir');
select cron.unschedule('convocations-vendredi-2245') where exists (select 1 from cron.job where jobname = 'convocations-vendredi-2245');
select cron.schedule('convocations-vendredi-2245', '45 20,21 * * 5', (select command from cron.job where jobname = 'convocations'));
select 'ok' as compo_visible_15min;
