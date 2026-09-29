-- Responsables d'équipe : chaque compte "delegue" gère les équipes cochées (1 à 5 = Seniors A à E).
alter table public.profiles add column if not exists equipes int[] not null default '{}';

-- Peut gérer les matchs de cette équipe (créer, saisir, désigner un délégué, supprimer)
create or replace function public.is_team_manager(p_equipe int) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from profiles where id = auth.uid() and role = 'delegue' and p_equipe = any(equipes));
$$;

-- Peut saisir ce match : admin, responsable de l'équipe, ou délégué désigné sur ce match
create or replace function public.can_manage(p_match uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from matches m where m.id = p_match and (
    public.is_team_manager(m.equipe) or (public.is_staff() and m.delegue_id = auth.uid())));
$$;

drop policy if exists "matches creation" on public.matches;
drop policy if exists "matches modification" on public.matches;
drop policy if exists "matches suppression" on public.matches;
create policy "matches creation" on public.matches for insert to authenticated with check (public.is_team_manager(equipe));
create policy "matches modification" on public.matches for update to authenticated
  using (public.can_manage(id))
  with check (public.is_team_manager(equipe) or delegue_id = auth.uid());
create policy "matches suppression" on public.matches for delete to authenticated using (public.is_team_manager(equipe));
select 'ok' as responsables;
