-- Suppression de compte : la connexion est supprimée, la fiche (nom) est gardée pour l'historique.
alter table public.profiles add column if not exists deleted_at timestamptz;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('pending','joueur','delegue','admin','supprime'));
-- la fiche survit à la suppression de la connexion
alter table public.profiles drop constraint if exists profiles_id_fkey;
-- l'historique pointe vers les fiches (conservées) et non plus vers les connexions
alter table public.matches drop constraint if exists matches_created_by_fkey;
alter table public.matches add constraint matches_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.events drop constraint if exists events_created_by_fkey;
alter table public.events add constraint events_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null;

create or replace function public.supprimer_compte(p_id uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_role text;
begin
  if p_id is distinct from auth.uid() and not public.is_admin() then raise exception 'non autorisé'; end if;
  select role into v_role from public.profiles where id = p_id;
  if v_role is null or v_role = 'supprime' then raise exception 'compte introuvable'; end if;
  if v_role = 'admin' and not exists (select 1 from public.profiles where role = 'admin' and id <> p_id) then
    raise exception 'dernier admin : impossible de supprimer ce compte';
  end if;
  delete from public.push_subscriptions where admin_id = p_id;
  update public.matches set delegue_id = null, delegue_nom = null where delegue_id = p_id and status <> 'termine';
  update public.profiles set role = 'supprime', email = null, equipes = '{}', deleted_at = now() where id = p_id;
  delete from auth.users where id = p_id;
end $$;
revoke all on function public.supprimer_compte(uuid) from public;
grant execute on function public.supprimer_compte(uuid) to authenticated;
select 'ok' as suppression;
