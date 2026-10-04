-- Rappel ~15 min avant le coup d'envoi si notre compo n'est pas saisie ou s'il manque des numéros :
-- notification aux responsables de l'équipe (aux admins si l'équipe n'en a pas) et au responsable score du match, une seule fois.
-- Appelé par /api/alerte-score (minuteur pg_cron toutes les 10 min, fenêtre de 5 à 20 min avant le match).
alter table public.matches add column if not exists compo_rappel_at timestamptz;

create or replace function public.compo_targets(p_cle text)
returns table(endpoint text, p256dh text, auth text, titre text, texte text, url text)
language plpgsql security definer set search_path = public, extensions as $$
declare m record; v_roster jsonb; v_total int; v_sans int; v_titre text; v_texte text;
begin
  if encode(digest(p_cle, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'alerte') then
    raise exception 'clé invalide';
  end if;
  for m in select x.id, x.equipe, x.home_name, x.away_name, x.kickoff, x.club_side, x.rosters, x.compo_cachee, x.delegue_id
             from matches x
            where x.status = 'prevu' and x.compo_rappel_at is null
              and x.kickoff between now() + interval '5 minutes' and now() + interval '20 minutes' loop
    v_roster := coalesce(case when m.compo_cachee then (select p.rosters from compos_privees p where p.match_id = m.id) end, m.rosters);
    v_roster := coalesce(v_roster -> coalesce(m.club_side, 'H'), '[]'::jsonb);
    select count(*), count(*) filter (where coalesce(trim(j->>'n'), '') = '') into v_total, v_sans
      from jsonb_array_elements(v_roster) j where coalesce(trim(j->>'name'), '') <> '' or coalesce(trim(j->>'n'), '') <> '';
    update matches set compo_rappel_at = now() where id = m.id;
    if v_total > 0 and v_sans = 0 then continue; end if;          -- compo complète : pas de rappel
    v_titre := case when v_total = 0 then '📋 Compo pas encore saisie' else '🔢 Numéros manquants dans la compo' end
               || ' · ' || m.home_name || ' – ' || m.away_name;
    v_texte := 'Coup d''envoi à ' || to_char(m.kickoff at time zone 'Europe/Paris', 'HH24"h"MI') || ' : '
               || case when v_total = 0 then 'saisis la compo avec les numéros des joueurs.'
                       else v_sans || ' joueur' || case when v_sans > 1 then 's' else '' end || ' sans numéro, ajoute-les avant le match.' end;
    return query select distinct on (s.endpoint) s.endpoint, s.p256dh, s.auth, v_titre, v_texte, ('/#/gerer/' || m.id::text || '/compo')::text
      from push_subscriptions s join profiles p on p.id = coalesce(s.user_id, s.admin_id)
      where (p.role = 'delegue' and m.equipe = any(p.equipes)) or p.id = m.delegue_id
         -- équipe sans responsable : les admins à la place
         or (p.role = 'admin' and not exists (select 1 from profiles d where d.role = 'delegue' and m.equipe = any(d.equipes)));
  end loop;
end $$;
revoke all on function public.compo_targets(text) from public;
grant execute on function public.compo_targets(text) to anon, authenticated;
select 'ok' as rappel_compo;
