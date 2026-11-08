-- Matchs du 08/11, d'après les feuilles FFF :
--  C : 32e « sort 14, entre 14 » → Amaury Lucas (14) pour Djylane Bigot (7)
--  D : les deux « Romain G. » (non départagés par la reprise automatique) : Romain Guillet n°1 (gardien, n°1 à la C les 04 et 18/10), Romain Gauthier n°3
--  F : Audrey Walgraef, réécrit « Walgreaf » par la feuille de convocation du club
do $$
declare nb int; res text := '';
begin
  perform set_config('asm.fusion', '1', true);
  update events set out_n = '7' where id = '033051ea-a274-4d9a-89bd-3c383559ae90' and out_n = '14' and in_n = '14';
  get diagnostics nb = row_count; res := 'C 32e : ' || nb;
  update matches m set rosters = jsonb_set(m.rosters, '{A}', (select jsonb_agg(case e->>'name'
      when 'Romain Guillet' then e || '{"n":"1","sub":false}'::jsonb
      when 'Romain Gauthier' then e || '{"n":"3","sub":false}'::jsonb else e end) from jsonb_array_elements(m.rosters->'A') e))
    where m.id = 'a84f2479-8869-4ce9-a5f4-6b60c904233e' and exists (select 1 from jsonb_array_elements(m.rosters->'A') e where e->>'name' in ('Romain Guillet', 'Romain Gauthier') and coalesce(e->>'n', '') = '');
  get diagnostics nb = row_count; res := res || ' | D Romains : ' || nb;
  update matches m set rosters = jsonb_set(m.rosters, '{H}', (select jsonb_agg(case when e->>'name' = 'Audrey Walgreaf' then jsonb_set(e, '{name}', '"Audrey Walgraef"') else e end) from jsonb_array_elements(m.rosters->'H') e))
    where m.id = '06e69645-ef1c-4875-8c00-0179512b1ccb' and exists (select 1 from jsonb_array_elements(m.rosters->'H') e where e->>'name' = 'Audrey Walgreaf');
  get diagnostics nb = row_count; res := res || ' | F compo : ' || nb;
  update votes_hdm set joueur = 'Audrey Walgraef' where match_id = '06e69645-ef1c-4875-8c00-0179512b1ccb' and joueur = 'Audrey Walgreaf';
  get diagnostics nb = row_count; res := res || ' | F votes : ' || nb;
  raise notice 'FAIT %', res;
end $$;
