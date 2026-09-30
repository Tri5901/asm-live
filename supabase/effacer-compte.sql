-- Effacer définitivement un compte déjà supprimé (admins) : son nom disparaît.
-- Ses actions restent dans l'historique, attribuées à la fiche générique « Compte effacé ».
insert into public.profiles (id, email, nom, role, deleted_at)
values ('00000000-0000-0000-0000-000000000000', null, 'Compte effacé', 'supprime', now())
on conflict (id) do nothing;

create or replace function public.effacer_compte(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare z uuid := '00000000-0000-0000-0000-000000000000';
begin
  if not public.is_admin() then raise exception 'réservé aux admins'; end if;
  if p_id = z or not exists (select 1 from profiles where id = p_id and role = 'supprime') then raise exception 'compte introuvable'; end if;
  update matches set created_by = z where created_by = p_id;
  update matches set rosters_by = z where rosters_by = p_id;
  update matches set delegue_id = null, delegue_nom = null where delegue_id = p_id;
  update events set created_by = z where created_by = p_id;
  delete from push_subscriptions where admin_id = p_id;
  delete from profiles where id = p_id;
end $$;
revoke all on function public.effacer_compte(uuid) from public, anon;
grant execute on function public.effacer_compte(uuid) to authenticated;
select 'ok' as effacer;
