-- Alerte 1 h avant un match sans responsable score : notification à ceux qui suivent l'équipe (cloche) et aux
-- responsables de l'équipe / admins, pour que quelqu'un présent au stade fasse la demande.
-- Un minuteur de la base (pg_cron, toutes les 10 min) appelle /api/alerte-score, qui demande les destinataires ici.
create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.matches add column if not exists alerte_score_at timestamptz;

create or replace function public.alerte_score_targets(p_cle text)
returns table(endpoint text, p256dh text, auth text, titre text, texte text, url text)
language plpgsql security definer set search_path = public, extensions as $$
declare m record;
begin
  if encode(digest(p_cle, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'alerte') then
    raise exception 'clé invalide';
  end if;
  for m in update matches set alerte_score_at = now()
      where status = 'prevu' and delegue_id is null and alerte_score_at is null
        and kickoff between now() + interval '45 minutes' and now() + interval '75 minutes'
      returning id, equipe, home_name, away_name, kickoff loop
    return query select distinct on (s.endpoint) s.endpoint, s.p256dh, s.auth,
        ('⏰ ' || m.home_name || ' – ' || m.away_name || ' à ' || to_char(m.kickoff at time zone 'Europe/Paris', 'HH24"h"MI'))::text,
        'Pas encore de responsable score. Tu es au stade ? Ouvre le match et fais la demande en un clic.'::text,
        ('/#/match/' || m.id::text)::text
      from push_subscriptions s left join profiles p on p.id = coalesce(s.user_id, s.admin_id)
      where m.equipe = any(s.equipes) or p.role = 'admin' or (p.role = 'delegue' and m.equipe = any(p.equipes));
  end loop;
end $$;
revoke all on function public.alerte_score_targets(text) from public;
grant execute on function public.alerte_score_targets(text) to anon, authenticated;

-- clé : enregistrée (empreinte) dans app_secrets ; le minuteur l'envoie à l'API
-- insert into public.app_secrets(name, hash) values ('alerte', encode(digest('<CLE>', 'sha256'), 'hex')) on conflict (name) do update set hash = excluded.hash;
-- select cron.schedule('alerte-score', '*/10 * * * *', $c$ select net.http_post(url := 'https://asm-live.vercel.app/api/alerte-score',
--   body := '{"cle":"<CLE>"}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb) $c$);
select 'ok' as alerte_score;
