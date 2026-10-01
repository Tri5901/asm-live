-- Résultats de toutes les équipes de la poule (relevés sur la page FFF « Résultats / calendrier »).
-- classements.resultats = [[idMatchFFF, 'AAAA-MM-JJTHH:MM', codeDom, nomDom, butsDom, butsExt, codeExt, nomExt], ...]
alter table public.classements add column if not exists resultats jsonb not null default '[]'::jsonb;
alter table public.equipes add column if not exists fff_poule text;

update public.equipes set fff_poule = v.u from (values
  (1, 'https://epreuves.fff.fr/competition/engagement/452589-regional-3/phase/1/2'),
  (2, 'https://epreuves.fff.fr/competition/engagement/454128-departemental-2-masculin/phase/1/2'),
  (3, 'https://epreuves.fff.fr/competition/engagement/454129-departemental-3-masculin/phase/1/4'),
  (4, 'https://epreuves.fff.fr/competition/engagement/454130-departemental-4-masculin/phase/1/4'),
  (5, 'https://epreuves.fff.fr/competition/engagement/454131-departemental-5-masculin/phase/1/6')
) as v(id, u) where equipes.id = v.id and equipes.fff_poule is null;

create or replace function public.enregistrer_classements(p_secret text, p_data jsonb) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare k text; v jsonb; n int := 0;
begin
  if encode(digest(p_secret, 'sha256'), 'hex') is distinct from (select hash from app_secrets where name = 'classements') then
    raise exception 'clé invalide';
  end if;
  for k, v in select * from jsonb_each(p_data) loop
    if k !~ '^\d+$' or not exists (select 1 from equipes where id = k::int) then continue; end if;
    if jsonb_typeof(v->'lignes') = 'array' and jsonb_array_length(v->'lignes') >= 2 then
      insert into classements (equipe, competition, lignes, source, updated_at)
      values (k::int, coalesce(v->>'competition', ''), v->'lignes', coalesce(v->>'source', (select fff_classement from equipes where id = k::int)), now())
      on conflict (equipe) do update set competition = coalesce(nullif(excluded.competition, ''), classements.competition),
        lignes = excluded.lignes, source = coalesce(excluded.source, classements.source), updated_at = now();
      n := n + 1;
    end if;
    -- résultats de la poule : fusion par identifiant de match (les nouveaux remplacent les anciens)
    if jsonb_typeof(v->'resultats') = 'array' and exists (select 1 from classements where equipe = k::int) then
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
select id, nom, fff_poule from public.equipes order by id;
