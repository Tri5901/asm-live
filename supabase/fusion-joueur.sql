-- La fusion ne doit pas changer « compo saisie par » : le suivi des compos ignore les mises à jour faites pendant une fusion
create or replace function public.track_rosters() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rosters is distinct from old.rosters and coalesce(current_setting('asm.fusion', true), '') <> '1' then new.rosters_by := auth.uid(); new.rosters_at := now(); end if;
  return new;
end $$;

-- Fusion de deux joueurs (doublon dû à une faute de frappe, un nom abrégé…) : dans toutes les compos,
-- les noms p_anciens sont remplacés par p_nouveau. Réservé aux admins et aux responsables d'équipe.
create or replace function public.fusionner_joueur(p_anciens text[], p_nouveau text) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'delegue')) then
    raise exception 'réservé aux responsables et aux admins';
  end if;
  perform set_config('asm.fusion', '1', true);
  if coalesce(trim(p_nouveau), '') = '' or coalesce(array_length(p_anciens, 1), 0) = 0 then raise exception 'noms manquants'; end if;
  update matches m set rosters = (
    select jsonb_object_agg(s.k, (
      select coalesce(jsonb_agg(case when e->>'name' = any(p_anciens) then jsonb_set(e, '{name}', to_jsonb(trim(p_nouveau))) else e end), '[]'::jsonb)
      from jsonb_array_elements(case when jsonb_typeof(s.v) = 'array' then s.v else '[]'::jsonb end) e))
    from jsonb_each(m.rosters) s(k, v))
  where jsonb_typeof(m.rosters) = 'object'
    and exists (select 1 from jsonb_each(m.rosters) s(k, v), jsonb_array_elements(case when jsonb_typeof(s.v) = 'array' then s.v else '[]'::jsonb end) e where e->>'name' = any(p_anciens));
  get diagnostics k = row_count; n := n + k;
  update compos_privees c set rosters = (
    select jsonb_object_agg(s.k, (
      select coalesce(jsonb_agg(case when e->>'name' = any(p_anciens) then jsonb_set(e, '{name}', to_jsonb(trim(p_nouveau))) else e end), '[]'::jsonb)
      from jsonb_array_elements(case when jsonb_typeof(s.v) = 'array' then s.v else '[]'::jsonb end) e))
    from jsonb_each(c.rosters) s(k, v))
  where jsonb_typeof(c.rosters) = 'object'
    and exists (select 1 from jsonb_each(c.rosters) s(k, v), jsonb_array_elements(case when jsonb_typeof(s.v) = 'array' then s.v else '[]'::jsonb end) e where e->>'name' = any(p_anciens));
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;
revoke all on function public.fusionner_joueur(text[], text) from public, anon;
grant execute on function public.fusionner_joueur(text[], text) to authenticated;
select 'ok' as fusionner_joueur;
