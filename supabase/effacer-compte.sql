-- Effacer définitivement un compte déjà supprimé (admins) : il disparaît de la page Accès,
-- mais ses actions restent dans l'historique avec son prénom et son nom.
alter table public.profiles add column if not exists efface boolean not null default false;

create or replace function public.effacer_compte(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'réservé aux admins'; end if;
  if not exists (select 1 from profiles where id = p_id and role = 'supprime' and not efface) then raise exception 'compte introuvable'; end if;
  update matches set delegue_id = null, delegue_nom = null where delegue_id = p_id and status <> 'termine';
  delete from push_subscriptions where admin_id = p_id;
  update profiles set efface = true, email = null, equipes = '{}' where id = p_id;
end $$;
revoke all on function public.effacer_compte(uuid) from public, anon;
grant execute on function public.effacer_compte(uuid) to authenticated;

-- un compte effacé ne peut plus être rattaché
create or replace function public.rattacher_compte(p_ancien uuid, p_nouveau uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_nom text; a int; b int; c int; d int;
begin
  if not public.is_admin() then raise exception 'réservé aux admins'; end if;
  if not exists (select 1 from profiles where id = p_ancien and role = 'supprime' and not efface) then raise exception 'ancien compte introuvable'; end if;
  select nom into v_nom from profiles where id = p_nouveau and role <> 'supprime';
  if not found then raise exception 'nouveau compte introuvable'; end if;
  update matches set created_by = p_nouveau where created_by = p_ancien; get diagnostics a = row_count;
  update matches set rosters_by = p_nouveau where rosters_by = p_ancien; get diagnostics b = row_count;
  update matches set delegue_id = p_nouveau, delegue_nom = v_nom where delegue_id = p_ancien; get diagnostics c = row_count;
  update events set created_by = p_nouveau where created_by = p_ancien; get diagnostics d = row_count;
  delete from push_subscriptions where admin_id = p_ancien;
  delete from profiles where id = p_ancien;
  return jsonb_build_object('matchs', a, 'compos', b, 'delegations', c, 'actions', d);
end $$;
revoke all on function public.rattacher_compte(uuid, uuid) from public, anon;
grant execute on function public.rattacher_compte(uuid, uuid) to authenticated;

-- l'ancienne fiche générique « Compte effacé » n'est plus utile (rien n'y est rattaché)
delete from public.profiles p where p.id = '00000000-0000-0000-0000-000000000000'
  and not exists (select 1 from public.matches m where m.created_by = p.id or m.rosters_by = p.id)
  and not exists (select 1 from public.events e where e.created_by = p.id);
select count(*) filter (where efface) as effaces, count(*) filter (where id = '00000000-0000-0000-0000-000000000000') as fiche_generique from public.profiles;
