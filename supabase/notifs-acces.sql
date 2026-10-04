-- Page Accès (admins) : qui a activé les notifications. Par compte : nombre d'appareils abonnés, équipes suivies
-- (buts), dernière mise à jour. Une ligne sans compte (user_id null) donne le nombre d'appareils abonnés sans compte.
-- Les abonnements eux-mêmes (adresses des téléphones) ne sont jamais renvoyés.
create or replace function public.notifs_comptes()
returns table(user_id uuid, appareils int, equipes int[], maj timestamptz)
language plpgsql security definer set search_path = public stable as $$
begin
  if not public.is_admin() then raise exception 'réservé aux admins'; end if;
  return query
    select coalesce(s.user_id, s.admin_id), count(*)::int,
           (select coalesce(array_agg(distinct e order by e), '{}') from push_subscriptions s2, unnest(s2.equipes) e
             where coalesce(s2.user_id, s2.admin_id) is not distinct from coalesce(s.user_id, s.admin_id)),
           max(s.updated_at)
      from push_subscriptions s
     group by coalesce(s.user_id, s.admin_id);
end $$;
revoke all on function public.notifs_comptes() from public, anon;
grant execute on function public.notifs_comptes() to authenticated;
select 'ok' as notifs_acces;
