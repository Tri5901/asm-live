-- Niveau de l'équipe adverse (championnat qu'elle joue), affiché sur la page des matchs de coupe.
alter table public.matches add column if not exists opp_niveau text;

-- maj_matchs accepte aussi {"type":"niveau","id":"<uuid>","opp_niveau":"District 3"} et opp_niveau dans un ajout
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

-- matchs de coupe du 11 octobre (niveaux connus : poules de nos équipes, tirage de la Ligue pour Entrammes)
update public.matches set opp_niveau = v.niv from (values
  (1, 'Coupe des Pays de la Loire · 2e tour', 'Régional 3'),
  (2, 'Coupe du District · 2e tour', 'District 3'),
  (3, 'Coupe du District · 2e tour', 'District 2'),
  (4, 'Challenge du District · 1er tour', 'District 5'),
  (5, 'Challenge du District · 1er tour', 'District 4')
) as v(eq, comp, niv) where matches.equipe = v.eq and matches.competition = v.comp and matches.opp_niveau is null;
select equipe, competition, home_name, away_name, opp_niveau from public.matches where opp_niveau is not null order by equipe;
