-- Historique des modifications d'un match : actions (ajout, correction, suppression), compos, statut, période,
-- responsable score, horaire. Écrit par des déclencheurs (personne ne peut le modifier), lu par les responsables et admins.
create table if not exists public.historique (
  id bigserial primary key,
  match_id uuid not null,
  at timestamptz not null default now(),
  par uuid default auth.uid(),
  par_nom text,
  quoi text not null,
  avant jsonb,
  apres jsonb
);
create index if not exists historique_match_idx on public.historique(match_id, at);
alter table public.historique enable row level security;
drop policy if exists "historique lecture" on public.historique;
create policy "historique lecture" on public.historique for select to authenticated using (public.is_staff() or public.can_manage(match_id));
revoke all on public.historique from anon, authenticated;
grant select on public.historique to authenticated;

create or replace function public.hist_ajout(p_match uuid, p_quoi text, p_avant jsonb, p_apres jsonb) returns void
language sql security definer set search_path = public as $$
  insert into historique (match_id, par, par_nom, quoi, avant, apres)
  values (p_match, auth.uid(), (select nom from profiles where id = auth.uid()), p_quoi, p_avant, p_apres);
$$;
revoke all on function public.hist_ajout(uuid, text, jsonb, jsonb) from public, anon, authenticated;

-- actions du match
create or replace function public.hist_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare a jsonb; b jsonb;
begin
  if tg_op <> 'INSERT' then a := to_jsonb(old) - 'notified_at' - 'created_at' - 'created_by'; end if;
  if tg_op <> 'DELETE' then b := to_jsonb(new) - 'notified_at' - 'created_at' - 'created_by'; end if;
  if tg_op = 'INSERT' then perform hist_ajout(new.match_id, 'action_ajout', null, b);
  elsif tg_op = 'DELETE' then perform hist_ajout(old.match_id, 'action_suppression', a, null);
  elsif a is distinct from b then perform hist_ajout(new.match_id, 'action_modif', a, b);
  end if;
  return null;
end $$;
drop trigger if exists hist_events on public.events;
create trigger hist_events after insert or update or delete on public.events for each row execute function public.hist_events();

-- compo, statut, période, responsable score, horaire
create or replace function public.hist_matches() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.rosters is distinct from old.rosters then perform hist_ajout(new.id, 'compo', old.rosters, new.rosters); end if;
  if new.status is distinct from old.status then perform hist_ajout(new.id, 'statut', to_jsonb(old.status), to_jsonb(new.status)); end if;
  if new.period is distinct from old.period then perform hist_ajout(new.id, 'periode', to_jsonb(old.period), to_jsonb(new.period)); end if;
  if new.delegue_id is distinct from old.delegue_id then perform hist_ajout(new.id, 'responsable', to_jsonb(old.delegue_nom), to_jsonb(new.delegue_nom)); end if;
  if new.kickoff is distinct from old.kickoff then perform hist_ajout(new.id, 'horaire', to_jsonb(old.kickoff), to_jsonb(new.kickoff)); end if;
  return null;
end $$;
drop trigger if exists hist_matches on public.matches;
create trigger hist_matches after update on public.matches for each row execute function public.hist_matches();

-- compo cachée au public
create or replace function public.hist_compos_privees() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then perform hist_ajout(new.match_id, 'compo', null, new.rosters);
  elsif new.rosters is distinct from old.rosters then perform hist_ajout(new.match_id, 'compo', old.rosters, new.rosters);
  end if;
  return null;
end $$;
drop trigger if exists hist_compos_privees on public.compos_privees;
create trigger hist_compos_privees after insert or update on public.compos_privees for each row execute function public.hist_compos_privees();
select 'ok' as historique;
