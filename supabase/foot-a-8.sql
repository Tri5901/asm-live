-- Senior F : foot à 8, 2 mi-temps de 40 min (Tristan, 11/10/2026).
-- equipes.mi_temps : durée d'une mi-temps de l'équipe, recopiée dans matches.half à la création de chaque match.
-- equipes.joueurs : nombre de joueurs sur le terrain (vue terrain à 8 ou à 11).
alter table public.equipes add column if not exists mi_temps int not null default 45;
alter table public.equipes add column if not exists joueurs int not null default 11;
update public.equipes set mi_temps = 40, joueurs = 8 where categorie = 'Senior F';

alter table public.matches drop constraint if exists matches_half_check;
alter table public.matches drop constraint if exists matches_half_45;
alter table public.matches add constraint matches_half_check check (half between 20 and 45);

create or replace function public.matches_mi_temps() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.half := coalesce((select mi_temps from equipes where id = new.equipe), 45);
  return new;
end $$;
drop trigger if exists matches_mi_temps on public.matches;
create trigger matches_mi_temps before insert on public.matches for each row execute function public.matches_mi_temps();

-- matchs déjà créés des équipes à 40 min
update public.matches m set half = e.mi_temps, acc = case when m.status = 'termine' then e.mi_temps * 60000 else m.acc end
  from public.equipes e where e.id = m.equipe and e.mi_temps <> 45 and m.half <> e.mi_temps and m.status in ('prevu', 'termine');

-- notification « Tu es la femme du match » pour les équipes féminines
do $$
declare d text;
begin
  d := pg_get_functiondef('public.hdm_targets(text)'::regprocedure);
  if position('fem' in d) > 0 then return; end if;
  if position('select x.id, x.home_name, x.away_name from matches x' in d) = 0
     or position('''🏆 Tu es l''''homme du match !''::text' in d) = 0
     or position('''Les votes t''''ont désigné homme du match de ''' in d) = 0 then raise exception 'hdm_targets : texte inattendu'; end if;
  d := replace(d, 'select x.id, x.home_name, x.away_name from matches x',
    'select x.id, x.home_name, x.away_name, coalesce((select e.categorie like ''% F'' from equipes e where e.id = x.equipe), false) as fem from matches x');
  d := replace(d, '''🏆 Tu es l''''homme du match !''::text',
    '(case when m.fem then ''🏆 Tu es la femme du match !'' else ''🏆 Tu es l''''homme du match !'' end)::text');
  d := replace(d, '''Les votes t''''ont désigné homme du match de ''',
    '''Les votes t''''ont désigné'' || case when m.fem then ''e femme'' else '' homme'' end || '' du match de ''');
  execute d;
end $$;
select (select string_agg(id || ':' || mi_temps || 'min/' || joueurs, ' ') from public.equipes) as equipes,
  (select string_agg(distinct half::text, ',') from public.matches where equipe = 6) as half_f,
  position('femme' in pg_get_functiondef('public.hdm_targets(text)'::regprocedure)) > 0 as notif_femme;
