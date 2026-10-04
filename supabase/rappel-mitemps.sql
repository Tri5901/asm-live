-- Rappels pendant le match, au responsable score (et aux responsables de l'équipe ; aux admins si l'équipe n'en a pas) :
--  - chrono de la 1re mi-temps à plus de 55 min sans passage à la mi-temps ;
--  - chrono de la 2e mi-temps à plus de 105 min (temps affiché) sans « Fin du match ».
-- Une seule fois chacun par match. Appelé par /api/alerte-score (minuteur toutes les 10 min).
alter table public.matches add column if not exists mitemps_rappel_at timestamptz;
alter table public.matches add column if not exists fin_rappel_at timestamptz;

create or replace function public.chrono_targets(p_cle text)
returns table(endpoint text, p256dh text, auth text, titre text, texte text, url text)
language plpgsql security definer set search_path = public, extensions as $$
declare m record; v_min numeric; v_titre text; v_texte text;
begin
  if encode(digest(p_cle, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'alerte') then
    raise exception 'clé invalide';
  end if;
  for m in select x.id, x.equipe, x.home_name, x.away_name, x.period, x.half, x.delegue_id,
                  (coalesce(x.acc, 0) + case when x.running then extract(epoch from now()) * 1000 - coalesce(x.started_at, 0) else 0 end) / 60000.0 as ecoule
             from matches x
            where x.status = 'direct' and x.running
              and ((x.period = 1 and x.mitemps_rappel_at is null) or (x.period = 2 and x.fin_rappel_at is null)) loop
    v_min := m.ecoule + case when m.period = 2 then coalesce(m.half, 45) else 0 end;   -- minute affichée
    if m.period = 1 and v_min >= coalesce(m.half, 45) + 10 then
      update matches set mitemps_rappel_at = now() where id = m.id;
      v_titre := '⏸️ Mi-temps ? · ' || m.home_name || ' – ' || m.away_name;
      v_texte := 'Le chrono est à ' || floor(v_min) || ' min en 1re mi-temps. Si c’est la pause, touche « Mi-temps » sur la page Gérer.';
    elsif m.period = 2 and v_min >= 2 * coalesce(m.half, 45) + 15 then
      update matches set fin_rappel_at = now() where id = m.id;
      v_titre := '🏁 Match terminé ? · ' || m.home_name || ' – ' || m.away_name;
      v_texte := 'Le chrono est à ' || floor(v_min) || ' min. Si le match est fini, touche « Fin du match » sur la page Gérer.';
    else
      continue;
    end if;
    return query select distinct on (s.endpoint) s.endpoint, s.p256dh, s.auth, v_titre, v_texte, ('/#/gerer/' || m.id::text)::text
      from push_subscriptions s join profiles p on p.id = coalesce(s.user_id, s.admin_id)
      where p.id = m.delegue_id or (p.role = 'delegue' and m.equipe = any(p.equipes))
         or (p.role = 'admin' and not exists (select 1 from profiles d where d.role = 'delegue' and m.equipe = any(d.equipes)));
  end loop;
end $$;
revoke all on function public.chrono_targets(text) from public;
grant execute on function public.chrono_targets(text) to anon, authenticated;
select 'ok' as rappel_mitemps;
