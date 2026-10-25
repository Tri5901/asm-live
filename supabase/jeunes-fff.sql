-- Jeunes (groupement GJ Mésanger St Géréon, club FFF 560414) : pages FFF des équipes, pour que les vérifications
-- programmées (horaires, classements, compos adverses) les reprennent dès que leur catégorie est visible sur le site
-- (les scripts ne listent que les équipes visibles). U11, U9 et U7 ne sont pas sur la FFF (plateaux).
update public.equipes e
   set fff_classement = 'https://epreuves.fff.fr/competition/club/560414-gjf-mesanger-st-gere/equipe/2026_196893_' || x.code || '/classement'
  from (values (7, 'U19_1'), (9, 'U19_4'), (10, 'U17_3'), (11, 'U15_5'), (12, 'U15_6'), (13, 'U15_7'), (14, 'U15F_8'),
               (15, 'U13_9'), (16, 'U13_10'), (17, 'U13_11'), (18, 'U13_12'), (19, 'U13F_13'), (20, 'U13F_14')) x(id, code)
 where e.id = x.id and e.fff_classement is null;
-- poules relevées le 25/10 (les autres le seront par la tâche du dimanche, sur la page du classement)
update public.equipes set fff_poule = 'https://epreuves.fff.fr/competition/engagement/451249-departemental-1-u18-masculin/phase/1/4' where id = 7 and fff_poule is null;
update public.equipes set fff_poule = 'https://epreuves.fff.fr/competition/engagement/452023-departemental-2-u13-masculin/phase/1/4' where id = 16 and fff_poule is null;

-- Classements : le relevé du dimanche peut donner « poule » (lien relevé sur la page du classement). La base le retient
-- s'il n'y en avait pas, ou s'il est d'une phase plus récente (jeunes : phase 2…) ; dans ce cas les résultats de
-- l'ancienne poule repartent à zéro. Un lien de même phase ne remplace jamais celui des seniors.
create or replace function public.enregistrer_classements(p_secret text, p_data jsonb) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare k text; v jsonb; n int := 0; v_nouvelle boolean;
begin
  if encode(digest(p_secret, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'classements') then
    raise exception 'clé invalide';
  end if;
  for k, v in select * from jsonb_each(p_data) loop
    if k !~ '^\d+$' or not exists (select 1 from equipes where id = k::int) then continue; end if;
    v_nouvelle := false;
    if coalesce(v->>'poule', '') ~ '^https://epreuves\.fff\.fr/competition/engagement/\d+-[a-z0-9-]+/phase/\d+/\d+$' then
      update equipes set fff_poule = v->>'poule'
       where id = k::int and fff_poule is distinct from v->>'poule'
         and (fff_poule is null or (regexp_match(v->>'poule', '/phase/(\d+)/'))[1]::int
                                    > coalesce((regexp_match(fff_poule, '/phase/(\d+)/'))[1]::int, 0));
      v_nouvelle := found;
    end if;
    if jsonb_typeof(v->'lignes') = 'array' and jsonb_array_length(v->'lignes') >= 2 then
      insert into classements (equipe, competition, lignes, source, updated_at)
      values (k::int, coalesce(v->>'competition', ''), v->'lignes', coalesce(v->>'source', (select fff_classement from equipes where id = k::int)), now())
      on conflict (equipe) do update set competition = coalesce(nullif(excluded.competition, ''), classements.competition),
        lignes = excluded.lignes, source = coalesce(excluded.source, classements.source), updated_at = now();
      n := n + 1;
    end if;
    if v_nouvelle then
      -- nouvelle poule : les résultats relevés cette fois-ci viennent encore de l'ancienne, on repart de zéro
      update classements set resultats = '[]'::jsonb where equipe = k::int;
    elsif jsonb_typeof(v->'resultats') = 'array' and exists (select 1 from classements where equipe = k::int) then
      -- résultats de la poule : fusion par identifiant de match (les nouveaux remplacent les anciens)
      update classements c set resultats = (
        select coalesce(jsonb_agg(x order by x->>1), '[]'::jsonb) from (
          select distinct on (x->>0) x from (
            select x, 1 as prio from jsonb_array_elements(v->'resultats') x
            union all
            select x, 2 from jsonb_array_elements(c.resultats) x
          ) t order by x->>0, prio
        ) u
      ) where c.equipe = k::int;
    end if;
  end loop;
  update classements_maj set fait_at = now() where id = 1;
  return n;
end $$;
revoke all on function public.enregistrer_classements(text, jsonb) from public;
grant execute on function public.enregistrer_classements(text, jsonb) to anon, authenticated;

select id, nom, actif, fff_classement is not null as page_fff, fff_poule is not null as poule from public.equipes order by cat_ordre, ordre;
