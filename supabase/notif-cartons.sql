-- Notifications aussi pour les cartons (jaune, blanc, rouge), envoyées aux mêmes abonnés que les buts
create or replace function public.push_targets(p_event uuid)
returns table(endpoint text, p256dh text, auth text) language plpgsql security definer set search_path = public as $$
declare v_match uuid;
begin
  if not public.can_manage((select match_id from events where id = p_event)) then raise exception 'réservé aux délégués'; end if;
  update events set notified_at = now()
    where id = p_event and k in ('goal', 'yellow', 'white', 'red') and notified_at is null returning match_id into v_match;
  if v_match is null then return; end if;
  return query select s.endpoint, s.p256dh, s.auth from push_subscriptions s
    join matches m on m.id = v_match where m.equipe = any(s.equipes);
end $$;
select 'ok' as notif_cartons;
