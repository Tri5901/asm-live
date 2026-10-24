-- Annonce ponctuelle aux abonnés d'un match (ex. « le match commence dans 2 h », Tristan 24/10) : téléphones abonnés
-- à l'équipe du match (les équipes exceptionnelles sont dans tous les abonnements qui suivent au moins une équipe).
-- Appelée par api/notify-annonce.js avec la clé des classements (stockée sur le PC, jamais dans le dépôt).
create or replace function public.annonce_targets(p_secret text, p_match uuid)
returns table(endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = public, extensions as $$
begin
  if encode(digest(p_secret, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'classements') then
    raise exception 'clé invalide';
  end if;
  return query select distinct s.endpoint, s.p256dh, s.auth
    from push_subscriptions s join matches m on m.id = p_match
   where m.equipe = any(s.equipes);
end $$;
revoke all on function public.annonce_targets(text, uuid) from public;
grant execute on function public.annonce_targets(text, uuid) to anon, authenticated;
select 'ok' as annonce_match;
