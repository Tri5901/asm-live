-- Noms des joueuses de la Senior F d'après la liste du groupe « Séniors F » envoyée par Tristan le 01/11 ;
-- numéros inchangés ; seulement notre côté des matchs de l'équipe 6 (compos, compos privées), votes femme du match, comptes reliés
do $$
declare r record; nb int; res text := '';
begin
  perform set_config('asm.fusion', '1', true);
  for r in select * from (values
      ('Delphine P.', 'Delphine Pavy'), ('Julie R.', 'Julie Rayer'), ('Leelou C.', 'Leelou Court'), ('Maelle B.', 'Maelle Bourguignon'),
      ('Nathalie Chauviere', 'Nathalie Chauvière'), ('Audrey Walgreaf', 'Audrey Walgraef'), ('Clara Percy Du Sert', 'Clara Percy du Sert'),
      ('Inès Magnac', 'Ines Magnac')) t(ancien, nouveau) loop
    update matches m set rosters = (
      select jsonb_object_agg(s.k, case when s.k = m.club_side and jsonb_typeof(s.v) = 'array' then (
        select coalesce(jsonb_agg(case when e->>'name' = r.ancien then jsonb_set(e, '{name}', to_jsonb(r.nouveau)) else e end), '[]'::jsonb)
        from jsonb_array_elements(s.v) e) else s.v end)
      from jsonb_each(m.rosters) s(k, v))
    where m.equipe = 6 and jsonb_typeof(m.rosters) = 'object'
      and exists (select 1 from jsonb_array_elements(coalesce(m.rosters->m.club_side, '[]'::jsonb)) e where e->>'name' = r.ancien);
    get diagnostics nb = row_count;
    res := res || r.nouveau || ' : ' || nb || ' match(s)';
    update compos_privees c set rosters = (
      select jsonb_object_agg(s.k, case when s.k = m.club_side and jsonb_typeof(s.v) = 'array' then (
        select coalesce(jsonb_agg(case when e->>'name' = r.ancien then jsonb_set(e, '{name}', to_jsonb(r.nouveau)) else e end), '[]'::jsonb)
        from jsonb_array_elements(s.v) e) else s.v end)
      from jsonb_each(c.rosters) s(k, v))
    from matches m
    where m.id = c.match_id and m.equipe = 6 and jsonb_typeof(c.rosters) = 'object'
      and exists (select 1 from jsonb_array_elements(coalesce(c.rosters->m.club_side, '[]'::jsonb)) e where e->>'name' = r.ancien);
    get diagnostics nb = row_count;
    if nb > 0 then res := res || ' + ' || nb || ' compo(s) privée(s)'; end if;
    update votes_hdm v set joueur = r.nouveau from matches m where m.id = v.match_id and m.equipe = 6 and v.joueur = r.ancien;
    get diagnostics nb = row_count;
    if nb > 0 then res := res || ', ' || nb || ' vote(s)'; end if;
    update profiles set joueur = r.nouveau where joueur = r.ancien;
    get diagnostics nb = row_count;
    if nb > 0 then res := res || ', compte relié suivi'; end if;
    res := res || ' ; ';
  end loop;
  raise notice 'FAIT % | comptes reliés : %', res, coalesce((select string_agg(nom || ' = ' || joueur, ', ') from profiles
    where joueur in ('Delphine Pavy', 'Julie Rayer', 'Leelou Court', 'Maelle Bourguignon', 'Nathalie Chauvière', 'Audrey Walgraef', 'Clara Percy du Sert', 'Ines Magnac')), 'aucun');
end $$;
