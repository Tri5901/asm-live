-- Rattrapage des notifications de but / carton : normalement envoyées par le téléphone du responsable score
-- 10 s après la saisie (délai pour « Annuler ») ; si le téléphone se met en veille entre-temps, elles ne partent pas.
-- Le minuteur (/api/alerte-score, chaque minute le week-end) envoie celles restées en attente depuis plus de 25 s.
create or replace function public.notif_retard(p_cle text) returns setof uuid
language plpgsql security definer set search_path = public, extensions as $$
begin
  if encode(digest(p_cle, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'alerte') then
    raise exception 'clé invalide';
  end if;
  return query select e.id from events e join matches m on m.id = e.match_id
    where e.k in ('goal', 'yellow', 'white', 'red') and e.notified_at is null and m.status = 'direct'
      and e.created_at < now() - interval '25 seconds' and e.created_at > now() - interval '20 minutes'
    order by e.created_at limit 10;
end $$;

-- mêmes destinataires que push_targets, avec la clé du minuteur au lieu d'un compte qui gère le match
create or replace function public.push_targets_cle(p_cle text, p_event uuid)
returns table(endpoint text, p256dh text, auth text) language plpgsql security definer set search_path = public, extensions as $$
declare v_match uuid;
begin
  if encode(digest(p_cle, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'alerte') then
    raise exception 'clé invalide';
  end if;
  update events set notified_at = now()
    where id = p_event and k in ('goal', 'yellow', 'white', 'red') and notified_at is null returning match_id into v_match;
  if v_match is null then return; end if;
  return query select s.endpoint, s.p256dh, s.auth from push_subscriptions s
    join matches m on m.id = v_match where m.equipe = any(s.equipes);
end $$;
revoke all on function public.notif_retard(text) from public;
revoke all on function public.push_targets_cle(text, uuid) from public;
grant execute on function public.notif_retard(text) to anon, authenticated;
grant execute on function public.push_targets_cle(text, uuid) to anon, authenticated;
select 'ok' as notif_rattrapage;
