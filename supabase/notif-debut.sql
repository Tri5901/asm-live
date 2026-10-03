-- Notification « coup d'envoi » : envoyée ~30 s après le lancement du match (le responsable score peut annuler
-- un lancement par erreur pendant 30 s). Un minuteur de la base (toutes les 30 s) appelle /api/alerte-score
-- seulement s'il y a un match à annoncer ; la base choisit les destinataires (une seule fois par match).
alter table public.matches add column if not exists direct_at timestamptz;
alter table public.matches add column if not exists debut_notifie_at timestamptz;

create or replace function public.matches_direct_at() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'prevu' and new.status = 'direct' then new.direct_at := now(); end if;
  if new.status = 'prevu' and old.status <> 'prevu' then new.direct_at := null; end if;
  return new;
end $$;
drop trigger if exists matches_direct_at on public.matches;
create trigger matches_direct_at before update of status on public.matches for each row execute function public.matches_direct_at();

-- marge de 35 s : laisse le temps à une annulation faite à la 29e seconde d'arriver
create or replace function public.debut_targets(p_cle text)
returns table(endpoint text, p256dh text, auth text, titre text, texte text, url text)
language plpgsql security definer set search_path = public, extensions as $$
declare m record;
begin
  if encode(digest(p_cle, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'alerte') then
    raise exception 'clé invalide';
  end if;
  for m in update matches set debut_notifie_at = now()
      where status = 'direct' and debut_notifie_at is null
        and direct_at between now() - interval '15 minutes' and now() - interval '35 seconds'
      returning id, equipe, home_name, away_name loop
    return query select distinct on (s.endpoint) s.endpoint, s.p256dh, s.auth,
        ('▶️ C''est parti ! ' || m.home_name || ' – ' || m.away_name)::text,
        'Coup d''envoi : suis le match en direct.'::text,
        ('/#/match/' || m.id::text)::text
      from push_subscriptions s where m.equipe = any(s.equipes);
  end loop;
end $$;
revoke all on function public.debut_targets(text) from public;
grant execute on function public.debut_targets(text) to anon, authenticated;

-- minuteur : toutes les 30 s, n'appelle l'API que s'il y a un match à annoncer (clé = celle de l'alerte « responsable score »)
-- select cron.schedule('debut-match', '30 seconds', $c$ select net.http_post(url := 'https://asm-live.vercel.app/api/alerte-score',
--   body := '{"cle":"<CLE>"}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb)
--   where exists (select 1 from public.matches where status = 'direct' and debut_notifie_at is null
--     and direct_at between now() - interval '15 minutes' and now() - interval '35 seconds') $c$);
select 'ok' as notif_debut;
