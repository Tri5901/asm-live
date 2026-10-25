-- Senior D – Ste Luce S/Loire US 3 (25/10, Challenge du District) : corrections d'après la feuille de match FFF.
--  1) le jaune adverse de la 1re mi-temps est pour Nolhan J. (n° 11) à la 17', pas pour le n° 6 à la 19' ;
--  2) numéros manquants de la D et remplaçants (Jona L. n° 12, Lilian F. n° 13, Henri V. n° 14) comme sur la feuille ;
--  3) nos remplacements de la 37' (Jona L. pour Valentin G., Lilian F. pour Micaël G.) et le jaune de Florian P. (72').
-- Le reste de la chronologie (saisie en direct) ne bouge pas. Match terminé : aucune notification ne part.
do $$
declare v_m constant uuid := '7a32443b-a00b-4ef2-aab0-dab6cc800d64'; nb int; v_ev text; v_h text;
begin
  update events set n = '11', min = '17''', sort = 17
   where id = '131f4b9e-c6c2-43d3-934c-d4bc0afb0766' and match_id = v_m and t = 'A' and k = 'yellow' and n = '6' and min = '19''';
  get diagnostics nb = row_count;
  if nb <> 1 then raise exception 'carton n° 6 de la 19'' introuvable'; end if;

  update matches set compo_source = 'feuille de match FFF', rosters = jsonb_set(rosters, '{H}', (
    select jsonb_agg(case p->>'name'
      when 'Hugo Pouilloux'    then p || '{"n":"1"}'
      when 'Florian Pellerin'  then p || '{"n":"4"}'
      when 'Valentin Gicqueau' then p || '{"n":"5"}'
      when 'Micaël Gautier'    then p || '{"n":"7"}'
      when 'Arthur Fonteneau'  then p || '{"n":"8"}'
      when 'Thomas Voisine'    then p || '{"n":"10"}'
      when 'Jona Launay'       then p || '{"n":"12","sub":true}'
      when 'Lilian Ferron'     then p || '{"n":"13","sub":true}'
      else p end order by o)
    from jsonb_array_elements(rosters->'H') with ordinality x(p, o)))
  where id = v_m and status = 'termine';
  get diagnostics nb = row_count;
  if nb <> 1 then raise exception 'match introuvable ou pas terminé'; end if;
  select string_agg(format('%s%s %s', p->>'n', case when (p->>'sub')::boolean then '(R)' else '' end, p->>'name'), ', ' order by (p->>'n')::int nulls first)
    into v_h from matches, jsonb_array_elements(rosters->'H') p where id = v_m;
  if exists (select 1 from matches, jsonb_array_elements(rosters->'H') p where id = v_m and coalesce(p->>'n', '') = '') then
    raise exception 'il reste un joueur sans numéro : %', v_h;
  end if;

  insert into events (id, match_id, t, k, n, out_n, in_n, min, sort, p)
  select gen_random_uuid(), v_m, 'H', x.k, x.n, x.o, x.i, x.mi, x.s, x.p
  from (values ('sub', null, '5', '12', '37''', 37, 1), ('sub', null, '7', '13', '37''', 37, 1), ('yellow', '4', null, null, '72''', 72, 2))
    as x(k, n, o, i, mi, s, p)
  where not exists (select 1 from events e where e.match_id = v_m and e.t = 'H' and e.k = x.k
    and coalesce(e.n, '') = coalesce(x.n, '') and coalesce(e.out_n, '') = coalesce(x.o, '') and coalesce(e.in_n, '') = coalesce(x.i, ''));
  get diagnostics nb = row_count;
  if nb <> 3 then raise exception '% événement(s) ajouté(s) au lieu de 3', nb; end if;

  select string_agg(format('%s %s %s %s', min, t, k, coalesce(n, out_n || '>' || in_n)), ' | ' order by sort, created_at)
    into v_ev from events where match_id = v_m;
  raise notice 'compo D : %', v_h;
  raise notice 'chronologie : %', v_ev;
  --TEST raise exception 'TEST compo D : % ### chronologie : %', v_h, v_ev;
end $$;

select min, t, k, n, out_n, in_n from events where match_id = '7a32443b-a00b-4ef2-aab0-dab6cc800d64' order by sort, created_at;
