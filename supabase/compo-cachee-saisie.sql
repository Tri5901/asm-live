-- Indique publiquement qu'une compo cachée a bien été saisie (sans rien révéler de son contenu),
-- pour afficher « Compo saisie, non accessible au public ».
alter table public.matches add column if not exists compo_cachee_saisie boolean not null default false;

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
    new.compo_cachee_saisie := exists (select 1 from compos_privees p where p.match_id = new.id
      and coalesce(jsonb_array_length(p.rosters->'H'), 0) + coalesce(jsonb_array_length(p.rosters->'A'), 0) > 0);
  elsif tg_op = 'UPDATE' and old.compo_cachee then
    -- on la rend publique
    select rosters into v from compos_privees where match_id = new.id;
    if v is not null and coalesce(jsonb_array_length(new.rosters->'H'), 0) + coalesce(jsonb_array_length(new.rosters->'A'), 0) = 0 then
      new.rosters := v;
    end if;
    delete from compos_privees where match_id = new.id;
    new.compo_cachee_saisie := false;
  end if;
  return new;
end $$;

-- matchs déjà cachés
update public.matches m set compo_cachee_saisie = exists (select 1 from public.compos_privees p where p.match_id = m.id
  and coalesce(jsonb_array_length(p.rosters->'H'), 0) + coalesce(jsonb_array_length(p.rosters->'A'), 0) > 0)
where m.compo_cachee;
select count(*) filter (where compo_cachee) as cachees, count(*) filter (where compo_cachee_saisie) as saisies from public.matches;
