-- Rôle joueur : aucun droit, sauf sur les matchs où il est désigné délégué
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('pending','joueur','delegue','admin'));

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('joueur','delegue','admin'));
$$;

create or replace function public.can_manage(p_match uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from matches m where m.id = p_match and (
    public.is_team_manager(m.equipe) or (public.is_member() and m.delegue_id = auth.uid())));
$$;

drop function if exists public.list_delegues();
create or replace function public.list_delegues() returns table(id uuid, nom text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(p.nom, ''), p.email), p.role from profiles p
  where public.is_staff() and p.role in ('joueur','delegue','admin') order by 2;
$$;
revoke all on function public.list_delegues() from public;
grant execute on function public.list_delegues() to authenticated;

create or replace function public.push_targets(p_event uuid)
returns table(endpoint text, p256dh text, auth text) language plpgsql security definer set search_path = public as $$
declare v_match uuid;
begin
  if not public.can_manage((select match_id from events where id = p_event)) then raise exception 'réservé aux délégués'; end if;
  update events set notified_at = now() where id = p_event and k = 'goal' and notified_at is null returning match_id into v_match;
  if v_match is null then return; end if;
  return query select s.endpoint, s.p256dh, s.auth from push_subscriptions s
    join matches m on m.id = v_match where m.equipe = any(s.equipes);
end $$;

create or replace function public.push_forget(p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'réservé aux membres'; end if;
  delete from push_subscriptions where endpoint = p_endpoint and admin_id is null;
end $$;
select 'ok' as joueurs;
