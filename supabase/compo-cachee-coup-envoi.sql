-- Compo cachée (Tristan, 24/10) : rendue publique au coup d'envoi, et la vue terrain la suit.
-- Tant que la compo est cachée, la place de départ et les changements de poste de la vue terrain (qui donnent les
-- numéros des titulaires) sont rangés avec elle dans compos_privees : la colonne publique ne garde que « on ».
alter table public.compos_privees add column if not exists terrain jsonb;
alter table public.compos_privees alter column rosters set default '{"H":[],"A":[]}'::jsonb;

create or replace function public.compo_cachee_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare v jsonb; vt jsonb;
begin
  if tg_op = 'UPDATE' and new.compo_cachee is distinct from old.compo_cachee
     and auth.uid() is not null and not public.is_team_manager(new.equipe) then
    raise exception 'réservé au responsable de l''équipe';
  end if;
  -- coup d'envoi (ou résultat entré directement) : la compo cachée devient publique, quel que soit celui qui le donne
  if tg_op = 'UPDATE' and new.compo_cachee and old.status = 'prevu' and new.status is distinct from 'prevu' then
    new.compo_cachee := false;
  end if;
  if new.compo_cachee and tg_op = 'UPDATE' then
    -- compo reçue alors qu'elle est cachée : on la range à l'abri
    if coalesce(jsonb_array_length(new.rosters->'H'), 0) + coalesce(jsonb_array_length(new.rosters->'A'), 0) > 0 then
      insert into compos_privees(match_id, rosters) values (new.id, new.rosters)
        on conflict (match_id) do update set rosters = excluded.rosters;
      new.rosters := '{"H":[],"A":[]}'::jsonb;
    end if;
    -- vue terrain : seul « on » reste public
    if new.terrain ? 'd' or new.terrain ? 'p' then
      insert into compos_privees(match_id, terrain) values (new.id, new.terrain)
        on conflict (match_id) do update set terrain = excluded.terrain;
      new.terrain := jsonb_build_object('on', coalesce((new.terrain->>'on')::boolean, false));
    end if;
    new.compo_cachee_saisie := exists (select 1 from compos_privees p where p.match_id = new.id
      and coalesce(jsonb_array_length(p.rosters->'H'), 0) + coalesce(jsonb_array_length(p.rosters->'A'), 0) > 0);
  elsif tg_op = 'UPDATE' and old.compo_cachee then
    -- on la rend publique, avec la vue terrain (activée ou non : le « on » public fait foi)
    select rosters, terrain into v, vt from compos_privees where match_id = new.id;
    if v is not null and coalesce(jsonb_array_length(new.rosters->'H'), 0) + coalesce(jsonb_array_length(new.rosters->'A'), 0) = 0 then
      new.rosters := v;
    end if;
    if vt is not null and not coalesce(new.terrain ? 'd', false) then
      new.terrain := vt || jsonb_build_object('on', coalesce((new.terrain->>'on')::boolean, (vt->>'on')::boolean, false));
    end if;
    delete from compos_privees where match_id = new.id;
    new.compo_cachee_saisie := false;
  end if;
  return new;
end $$;

-- matchs déjà cachés dont la vue terrain est publique : on la range (le déclencheur s'en charge)
update public.matches set terrain = terrain where compo_cachee and (terrain ? 'd' or terrain ? 'p');
select count(*) filter (where compo_cachee) as cachees from public.matches;
