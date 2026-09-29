-- But contre son camp adverse (coupe B du 27/09) + D n°13 = Lucas Garçon (coupe D du 27/09)
update public.events set n = 'CSC'
where k = 'goal' and n is null and t = 'A'
  and match_id = (select id from public.matches where equipe = 2 and competition = 'Coupe du District · 1er tour');
update public.matches set rosters = replace(rosters::text, '"Lucas G."', '"Lucas Garçon"')::jsonb
where equipe = 4 and competition = 'Coupe du District · 1er tour';
select (select count(*) from public.events where n = 'CSC') as csc,
       (select count(*) from public.matches where rosters::text like '%Lucas Garçon%') as garcon;
