-- Notification à l'homme du match, une fois le vote terminé (coup d'envoi + 24 h) : au(x) gagnant(s) qui ont un compte
-- lié à leur nom dans les compos (profiles.joueur) et les notifications activées. Une seule fois par match.
-- Appelé par /api/alerte-score (minuteur toutes les 10 min).
alter table public.matches add column if not exists hdm_notif_at timestamptz;

create or replace function public.hdm_targets(p_cle text)
returns table(endpoint text, p256dh text, auth text, titre text, texte text, url text)
language plpgsql security definer set search_path = public, extensions as $$
declare m record;
begin
  if encode(digest(p_cle, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'alerte') then
    raise exception 'clé invalide';
  end if;
  for m in select x.id, x.home_name, x.away_name from matches x
            where x.status = 'termine' and x.hdm_notif_at is null
              and now() > x.kickoff + interval '24 hours' and x.kickoff > now() - interval '4 days' loop
    update matches set hdm_notif_at = now() where id = m.id;
    return query
      with v as (select v.joueur, count(*)::int as n from votes_hdm v where v.match_id = m.id group by v.joueur),
           g as (select v.joueur from v where v.n = (select max(n) from v))
      select distinct on (s.endpoint) s.endpoint, s.p256dh, s.auth,
             '🏆 Tu es l''homme du match !'::text,
             ('Les votes t''ont désigné homme du match de ' || m.home_name || ' – ' || m.away_name || '. Bravo !')::text,
             ('/#/match/' || m.id::text)::text
        from g join profiles p on lower(trim(p.joueur)) = lower(trim(g.joueur)) and p.role not in ('supprime', 'pending')
        join push_subscriptions s on coalesce(s.user_id, s.admin_id) = p.id;
  end loop;
end $$;
revoke all on function public.hdm_targets(text) from public;
grant execute on function public.hdm_targets(text) to anon, authenticated;

-- les matchs déjà terminés depuis plus de 24 h ne déclenchent rien (pas de notif en retard)
update matches set hdm_notif_at = now() where status = 'termine' and now() > kickoff + interval '24 hours' and hdm_notif_at is null;
select 'ok' as notif_hdm;
