-- Compos adverses relevées sur la feuille de match FFF (tâche programmée du mardi, clé des classements).
-- 1) page FFF de chaque match (relevée par la vérification des horaires) ; 2) remplissage de la compo adverse
--    seulement si elle est vide ou sans noms (numéros 1 à 14 mis au coup d'envoi) : une compo saisie n'est jamais écrasée.
alter table public.matches add column if not exists fff_match text;

create or replace function public.maj_matchs(p_secret text, p_data jsonb) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare x jsonb; n int := 0; k int;
begin
  if encode(digest(p_secret, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'classements') then
    raise exception 'clé invalide';
  end if;
  for x in select * from jsonb_array_elements(p_data) loop
    k := 0;
    if x->>'type' = 'horaire' then
      update matches set kickoff = (x->>'kickoff')::timestamptz
        where id = (x->>'id')::uuid and status = 'prevu' and kickoff is distinct from (x->>'kickoff')::timestamptz;
      get diagnostics k = row_count;
    elsif x->>'type' = 'logo' then
      update matches set opp_logo = x->>'opp_logo'
        where id = (x->>'id')::uuid and opp_logo is null and x->>'opp_logo' like 'https://cdn-transverse.azureedge.net/phlogos/BC%';
      get diagnostics k = row_count;
    elsif x->>'type' = 'niveau' then
      update matches set opp_niveau = left(x->>'opp_niveau', 40)
        where id = (x->>'id')::uuid and coalesce(x->>'opp_niveau', '') <> '' and opp_niveau is distinct from left(x->>'opp_niveau', 40);
      get diagnostics k = row_count;
    elsif x->>'type' = 'lieu' then
      update matches set lieu = left(x->>'lieu', 120), adresse = left(x->>'adresse', 200)
        where id = (x->>'id')::uuid and status = 'prevu' and coalesce(x->>'adresse', '') <> ''
          and (lieu, adresse) is distinct from (left(x->>'lieu', 120), left(x->>'adresse', 200));
      get diagnostics k = row_count;
    elsif x->>'type' = 'fff' then
      update matches set fff_match = x->>'fff_match'
        where id = (x->>'id')::uuid and x->>'fff_match' ~ '^/competition/match/\d+[a-z0-9-]*$' and fff_match is distinct from x->>'fff_match';
      get diagnostics k = row_count;
    elsif x->>'type' = 'ajout' then
      insert into matches (kickoff, competition, equipe, club_side, home_name, away_name, opp_logo, opp_niveau)
      select (x->>'kickoff')::timestamptz, x->>'competition', (x->>'equipe')::int, x->>'club_side', x->>'home_name', x->>'away_name',
             case when x->>'opp_logo' like 'https://cdn-transverse.azureedge.net/phlogos/BC%' then x->>'opp_logo' end,
             nullif(left(x->>'opp_niveau', 40), '')
      where exists (select 1 from equipes where id = (x->>'equipe')::int)
        and x->>'club_side' in ('H', 'A') and coalesce(x->>'competition', '') <> ''
        and not exists (select 1 from matches m where m.equipe = (x->>'equipe')::int and m.competition = x->>'competition');
      get diagnostics k = row_count;
    end if;
    n := n + k;
  end loop;
  return n;
end $$;
revoke all on function public.maj_matchs(text, jsonb) from public;
grant execute on function public.maj_matchs(text, jsonb) to anon, authenticated;

-- p_joueurs = [{"n":"7","name":"Hugo Martin","sub":false}, ...] (équipe adverse)
create or replace function public.compo_adverse_fff(p_secret text, p_match uuid, p_joueurs jsonb) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare v_side text; v_roster jsonb; k int;
begin
  if encode(digest(p_secret, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'classements') then
    raise exception 'clé invalide';
  end if;
  if jsonb_typeof(p_joueurs) <> 'array' or jsonb_array_length(p_joueurs) = 0 or jsonb_array_length(p_joueurs) > 30 then return 0; end if;
  select case when club_side = 'A' then 'H' else 'A' end into v_side from matches where id = p_match;
  if v_side is null then return 0; end if;
  select coalesce(jsonb_agg(jsonb_build_object('n', left(coalesce(j->>'n', ''), 3), 'name', left(trim(coalesce(j->>'name', '')), 60),
                                               'sub', coalesce((j->>'sub')::boolean, false))), '[]'::jsonb)
    into v_roster from jsonb_array_elements(p_joueurs) j where trim(coalesce(j->>'name', '')) <> '';
  if jsonb_array_length(v_roster) = 0 then return 0; end if;
  update matches m set rosters = jsonb_set(coalesce(m.rosters, '{"H":[],"A":[]}'::jsonb), array[v_side], v_roster)
    where m.id = p_match
      and not exists (select 1 from jsonb_array_elements(coalesce(m.rosters->v_side, '[]'::jsonb)) p where trim(coalesce(p->>'name', '')) <> '');
  get diagnostics k = row_count;
  return k;
end $$;
revoke all on function public.compo_adverse_fff(text, uuid, jsonb) from public;
grant execute on function public.compo_adverse_fff(text, uuid, jsonb) to anon, authenticated;
select 'ok' as compo_adverse_fff;
