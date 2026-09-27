-- Délégué désigné pour un match.
-- Sans délégué désigné : tous les délégués peuvent gérer le match. Avec : seulement lui et les admins.
alter table public.matches add column if not exists delegue_id uuid references public.profiles(id) on delete set null;
alter table public.matches add column if not exists delegue_nom text;

create or replace function public.can_manage(p_match uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.is_staff() and exists (
    select 1 from matches m where m.id = p_match and (m.delegue_id is null or m.delegue_id = auth.uid())));
$$;

-- Liste des délégués (nom seulement) pour choisir qui gère un match
create or replace function public.list_delegues() returns table(id uuid, nom text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(p.nom, ''), p.email) from profiles p
  where public.is_staff() and p.role in ('delegue','admin') order by 2;
$$;
revoke all on function public.list_delegues() from public;
grant execute on function public.list_delegues() to authenticated;

drop policy if exists "matches staff" on public.matches;
drop policy if exists "matches creation" on public.matches;
drop policy if exists "matches modification" on public.matches;
drop policy if exists "matches suppression" on public.matches;
create policy "matches creation" on public.matches for insert to authenticated with check (public.is_staff());
create policy "matches modification" on public.matches for update to authenticated
  using (public.can_manage(id))
  with check (public.is_admin() or delegue_id is null or delegue_id = auth.uid());
create policy "matches suppression" on public.matches for delete to authenticated using (public.can_manage(id));

drop policy if exists "events staff" on public.events;
create policy "events staff" on public.events for all to authenticated
  using (public.can_manage(match_id)) with check (public.can_manage(match_id));
select 'ok' as delegues;
