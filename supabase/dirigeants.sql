-- Rôle dirigeant : mêmes droits qu'un joueur (aucun, sauf les matchs où il est désigné délégué)
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('pending','joueur','dirigeant','delegue','admin','supprime'));

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('joueur','dirigeant','delegue','admin'));
$$;

create or replace function public.list_delegues() returns table(id uuid, nom text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(p.nom, ''), p.email), p.role from profiles p
  where public.is_staff() and p.role in ('joueur','dirigeant','delegue','admin') order by 2;
$$;
revoke all on function public.list_delegues() from public;
grant execute on function public.list_delegues() to authenticated;
select 'ok' as dirigeants;
