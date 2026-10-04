-- Historique : comment la compo a été entrée (saisie à la main, photo de la feuille, liste collée, convocation du site,
-- feuille de match FFF, numéros automatiques au coup d'envoi, fusion de joueurs…).
-- L'appli envoie matches.compo_source avec la compo ; un déclencheur « avant » le note pour l'historique puis l'efface
-- (il ne reste jamais d'ancienne valeur). Sans valeur, la source est déduite (import automatique, fusion…).
alter table public.historique add column if not exists source text;
alter table public.matches add column if not exists compo_source text;

drop function if exists public.hist_ajout(uuid, text, jsonb, jsonb);
create or replace function public.hist_ajout(p_match uuid, p_quoi text, p_avant jsonb, p_apres jsonb, p_source text default null) returns void
language sql security definer set search_path = public as $$
  insert into historique (match_id, par, par_nom, quoi, avant, apres, source)
  values (p_match, auth.uid(), (select nom from profiles where id = auth.uid()), p_quoi, p_avant, p_apres, p_source);
$$;
revoke all on function public.hist_ajout(uuid, text, jsonb, jsonb, text) from public, anon, authenticated;

-- « avant » : retient la source pour cette modification, puis l'efface de la ligne
create or replace function public.hist_compo_source() returns trigger
language plpgsql security definer set search_path = public as $$
declare v text := nullif(trim(coalesce(new.compo_source, '')), ''); c text := coalesce(new.club_side, 'H');
begin
  if new.rosters is distinct from old.rosters then
    if v is null then
      v := case
        when coalesce(current_setting('asm.fusion', true), '') <> '' then 'fusion de joueurs'
        when auth.uid() is null and (new.rosters -> c) is distinct from (old.rosters -> c) then 'convocation du site du club'
        when auth.uid() is null then 'feuille de match FFF'
        else 'appli' end;
    end if;
    perform set_config('asm.compo_source', left(v, 80), true);
  end if;
  new.compo_source := null;
  return new;
end $$;
drop trigger if exists a_hist_compo_source on public.matches;
create trigger a_hist_compo_source before update on public.matches for each row execute function public.hist_compo_source();

create or replace function public.hist_matches() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.rosters is distinct from old.rosters then
    perform hist_ajout(new.id, 'compo', old.rosters, new.rosters, nullif(current_setting('asm.compo_source', true), ''));
  end if;
  if new.status is distinct from old.status then perform hist_ajout(new.id, 'statut', to_jsonb(old.status), to_jsonb(new.status)); end if;
  if new.period is distinct from old.period then perform hist_ajout(new.id, 'periode', to_jsonb(old.period), to_jsonb(new.period)); end if;
  if new.delegue_id is distinct from old.delegue_id then perform hist_ajout(new.id, 'responsable', to_jsonb(old.delegue_nom), to_jsonb(new.delegue_nom)); end if;
  if new.kickoff is distinct from old.kickoff then perform hist_ajout(new.id, 'horaire', to_jsonb(old.kickoff), to_jsonb(new.kickoff)); end if;
  return null;
end $$;

create or replace function public.hist_compos_privees() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then perform hist_ajout(new.match_id, 'compo', null, new.rosters, nullif(current_setting('asm.compo_source', true), ''));
  elsif new.rosters is distinct from old.rosters then perform hist_ajout(new.match_id, 'compo', old.rosters, new.rosters, nullif(current_setting('asm.compo_source', true), ''));
  end if;
  return null;
end $$;
select 'ok' as historique_source;
