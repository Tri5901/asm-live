-- Lieu des matchs (stade et adresse relevés sur la page du match FFF) : bouton Waze sur les matchs à l'extérieur.
alter table public.matches add column if not exists lieu text;
alter table public.matches add column if not exists adresse text;

-- maj_matchs (tâche « Matchs ASM ») : nouveau type {"type":"lieu","id":"<uuid>","lieu":"…","adresse":"…"}
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
select 'ok' as lieu_match;
