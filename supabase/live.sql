-- Live vidéo des tirs au but (LiveKit) : pendant la séance, n'importe quel compte peut filmer ; une seule personne à la fois.
-- live_par / live_nom : qui filme ; live_at : battement envoyé par son téléphone toutes les 20 s (live considéré fini après 60 s sans).
alter table public.matches add column if not exists live_par uuid;
alter table public.matches add column if not exists live_nom text;
alter table public.matches add column if not exists live_at timestamptz;

create or replace function public.live_demarrer(p_match uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_nom text; m matches;
begin
  select nom into v_nom from profiles where id = auth.uid() and role not in ('supprime');
  if not found then raise exception 'il faut un compte'; end if;
  select * into m from matches where id = p_match for update;
  if not found or m.status <> 'direct' or m.tab is null then raise exception 'le live n''est possible que pendant les tirs au but'; end if;
  if m.live_par is not null and m.live_par <> auth.uid() and m.live_at > now() - interval '60 seconds' then
    raise exception 'déjà filmé par %', coalesce(m.live_nom, 'quelqu''un');
  end if;
  update matches set live_par = auth.uid(), live_nom = coalesce(nullif(v_nom, ''), 'Sans nom'), live_at = now() where id = p_match;
  return 'ok';
end $$;

-- battement du téléphone qui filme (renvoie false si quelqu'un a coupé le live)
create or replace function public.live_battement(p_match uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update matches set live_at = now() where id = p_match and live_par = auth.uid();
  return found;
end $$;

-- arrêt : par celui qui filme, ou coupé par le responsable score / responsable d'équipe / admin
create or replace function public.live_arreter(p_match uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update matches set live_par = null, live_nom = null, live_at = null
   where id = p_match and (live_par = auth.uid() or public.can_manage(p_match));
  return found;
end $$;

revoke all on function public.live_demarrer(uuid) from public, anon;
revoke all on function public.live_battement(uuid) from public, anon;
revoke all on function public.live_arreter(uuid) from public, anon;
grant execute on function public.live_demarrer(uuid) to authenticated;
grant execute on function public.live_battement(uuid) to authenticated;
grant execute on function public.live_arreter(uuid) to authenticated;
select 'ok' as live;
