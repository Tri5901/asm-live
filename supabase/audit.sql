-- Historique : qui a créé un match / une action, qui a saisi la compo (rempli par la base, pas par le téléphone)
alter table public.matches add column if not exists rosters_by uuid references public.profiles(id) on delete set null;
alter table public.matches add column if not exists rosters_at timestamptz;
create or replace function public.track_rosters() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rosters is distinct from old.rosters then new.rosters_by := auth.uid(); new.rosters_at := now(); end if;
  return new;
end $$;
drop trigger if exists matches_rosters_audit on public.matches;
create trigger matches_rosters_audit before update on public.matches for each row execute function public.track_rosters();
create or replace function public.force_creator() returns trigger language plpgsql security definer set search_path = public as $$
begin new.created_by := auth.uid(); return new; end $$;
drop trigger if exists events_creator on public.events;
create trigger events_creator before insert on public.events for each row execute function public.force_creator();
drop trigger if exists matches_creator on public.matches;
create trigger matches_creator before insert on public.matches for each row execute function public.force_creator();
select 'ok' as audit;
