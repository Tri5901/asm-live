-- Compo cachée au public : décidée par le responsable de l'équipe ou un admin.
-- Quand elle est cachée, la compo est rangée dans une table privée (lisible seulement par ceux qui gèrent
-- le match) et la colonne publique reste vide : elle n'est ni affichée ni récupérable.
alter table public.matches add column if not exists compo_cachee boolean not null default false;

create table if not exists public.compos_privees (
  match_id uuid primary key references public.matches(id) on delete cascade,
  rosters jsonb not null
);
alter table public.compos_privees enable row level security;
drop policy if exists "compos privees lecture" on public.compos_privees;
create policy "compos privees lecture" on public.compos_privees for select to authenticated using (public.can_manage(match_id));
revoke all on public.compos_privees from anon;
grant select on public.compos_privees to authenticated;

create or replace function public.compo_cachee_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if tg_op = 'UPDATE' and new.compo_cachee is distinct from old.compo_cachee
     and auth.uid() is not null and not public.is_team_manager(new.equipe) then
    raise exception 'réservé au responsable de l''équipe';
  end if;
  if new.compo_cachee and tg_op = 'UPDATE' then
    -- compo reçue alors qu'elle est cachée : on la range à l'abri
    if coalesce(jsonb_array_length(new.rosters->'H'), 0) + coalesce(jsonb_array_length(new.rosters->'A'), 0) > 0 then
      insert into compos_privees(match_id, rosters) values (new.id, new.rosters)
        on conflict (match_id) do update set rosters = excluded.rosters;
      new.rosters := '{"H":[],"A":[]}'::jsonb;
    end if;
  elsif tg_op = 'UPDATE' and old.compo_cachee then
    -- on la rend publique
    select rosters into v from compos_privees where match_id = new.id;
    if v is not null and coalesce(jsonb_array_length(new.rosters->'H'), 0) + coalesce(jsonb_array_length(new.rosters->'A'), 0) = 0 then
      new.rosters := v;
    end if;
    delete from compos_privees where match_id = new.id;
  end if;
  return new;
end $$;
-- nom en « zz » : passe après matches_rosters_audit (qui note qui a saisi la compo)
drop trigger if exists matches_zz_compo_cachee on public.matches;
create trigger matches_zz_compo_cachee before update on public.matches
  for each row execute function public.compo_cachee_trg();
select 'ok' as compo_cachee;
