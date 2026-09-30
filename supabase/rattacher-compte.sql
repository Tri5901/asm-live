-- Rattacher un compte supprimé à un nouveau compte : tout l'historique de l'ancienne fiche
-- (matchs créés, compos saisies, actions, délégations) passe au nouveau compte, puis l'ancienne fiche est effacée.
create or replace function public.rattacher_compte(p_ancien uuid, p_nouveau uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_nom text; a int; b int; c int; d int;
begin
  if not public.is_admin() then raise exception 'réservé aux admins'; end if;
  if p_ancien = '00000000-0000-0000-0000-000000000000' or not exists (select 1 from profiles where id = p_ancien and role = 'supprime') then raise exception 'ancien compte introuvable'; end if;
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
select 'ok' as rattacher;
