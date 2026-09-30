-- Demande de mise à jour des classements par un admin : prévient les autres admins par notification
-- (une seule fois par demande, dans les 5 minutes). La mise à jour elle-même reste manuelle hors lundi.
alter table public.classements_maj add column if not exists notifie_at timestamptz;

create or replace function public.maj_notify_targets()
returns table(endpoint text, p256dh text, auth text, nom text)
language plpgsql security definer set search_path = public as $$
declare v_nom text;
begin
  if not public.is_admin() then raise exception 'réservé aux admins'; end if;
  update classements_maj set notifie_at = now()
   where id = 1 and demande_at > now() - interval '5 minutes' and (notifie_at is null or notifie_at < demande_at)
   returning coalesce(demande_par, '?') into v_nom;
  if v_nom is null then return; end if;
  return query select s.endpoint, s.p256dh, s.auth, v_nom from push_subscriptions s
    join profiles p on p.id = s.admin_id where p.role = 'admin' and s.admin_id <> auth.uid();
end $$;
revoke all on function public.maj_notify_targets() from public, anon;
grant execute on function public.maj_notify_targets() to authenticated;
select 'ok' as maj_notif;
